import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { issueHandoverCode } from '@/lib/handover-code'
import { getPickupConfig } from '@/lib/pickup'
import { audit } from '@/lib/audit'

// POST /api/orders/[id]/handover-code
// Owner-pull issuance of the handover code (Invariants I3 + I5). Only the order's
// own customer (or staff) may call it. It stores ONLY the hash and returns the RAW
// code so the customer's app can display it. The raw code is returned ONCE, to the
// owner, over the authenticated session — never persisted, never sent by
// SMS/WhatsApp/push, never logged.
//
// Two modes (Invariant I3 — the raw code lives only on the owner's device + server
// hash, so it cannot be re-shown once issued):
//   • mount/auto (default): IDEMPOTENT — if a code already exists it is left intact
//     and we report `alreadyActive` WITHOUT rotating, so a reopen on a second device
//     can never invalidate the code the customer is already reading to the fulfiller.
//   • { rotate:true } (the "Refresh code" button): always mints a fresh code and
//     kills the old one — the customer explicitly chose to replace it.
//
// Active states where a code is meaningful: paid and not yet terminal.
const PICKUP_STATES   = ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY']
const DELIVERY_STATES = ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'PICKED_UP']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The "Refresh code" action sets rotate:true; a bare page-mount pull omits it.
  let rotate = false
  try { rotate = (await req.json())?.rotate === true } catch { /* no body → auto pull */ }

  // Cheap throttle so the refresh button can't be hammered.
  const rl = await rateLimitGeneric(`handover-issue:${id}:${session.userId ?? session.phone}`, 12, 60)
  if (!rl.success) return NextResponse.json({ error: 'Slow down a moment, then try again.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: order, error } = await db
    .from('orders')
    .select('id, customer_id, delivery_type, status, payment_status, leave_at_gate, ready_at')
    .eq('id', id)
    .single()
  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const isPickup = order.delivery_type === 'PICKUP'

  // Flag gate by order type → endpoint unreachable for the off feature.
  if (!(await getFeature(isPickup ? 'pickup_v1' : 'delivery_handover_v1'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Ownership (BOLA / I5): only the order's customer or staff may pull the code.
  const isStaff = session.role === 'admin' || session.role === 'super_admin'
  if (!isStaff && (session.role !== 'customer' || session.userId !== order.customer_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (order.payment_status !== 'PAID') {
    return NextResponse.json({ error: 'This order isn’t paid yet.' }, { status: 400 })
  }
  // Leave-at-gate delivery waives the door code — there is nothing to issue.
  if (!isPickup && order.leave_at_gate) {
    return NextResponse.json({ error: 'This delivery is set to leave-at-gate; no code is needed.' }, { status: 400 })
  }
  const allowed = isPickup ? PICKUP_STATES : DELIVERY_STATES
  if (!allowed.includes(order.status as string)) {
    return NextResponse.json({ error: 'A code isn’t available for this order right now.' }, { status: 400 })
  }

  const { code, alreadyActive } = await issueHandoverCode(db, id, { rotate })

  // A code is already live on the customer's other device — don't rotate it out from
  // under the fulfiller. Tell the client so it can prompt the customer to Refresh
  // here (which DOES rotate) if they can't see the original.
  if (!code && alreadyActive) {
    return NextResponse.json(
      { code: null, alreadyActive: true, kind: isPickup ? 'pickup' : 'delivery' },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    )
  }
  if (!code) return NextResponse.json({ error: 'Could not issue a code. Please try again.' }, { status: 500 })

  // Server-authoritative forfeit deadline for pickup (Invariant I7): the 1h25m
  // window starts when the food is READY (ready_at), not at payment — the customer
  // is never charged prep time. Null until READY (no countdown yet) and for
  // delivery. The client only displays this; it cannot extend it.
  let deadline: string | null = null
  if (isPickup && order.status === 'READY' && order.ready_at) {
    const cfg = await getPickupConfig(db)
    deadline = new Date(new Date(order.ready_at as string).getTime() + cfg.holdMinutes * 60_000).toISOString()
  }

  // Audit the ISSUANCE — never the code itself (Invariant I3).
  void audit({
    actor_id: session.phone, actor_role: session.role,
    action: 'handover_code_issued', target_table: 'orders', target_id: id,
    new_value: { kind: isPickup ? 'pickup' : 'delivery' },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  // no-store: a handover code must never sit in any shared/proxy cache.
  return NextResponse.json(
    { code, kind: isPickup ? 'pickup' : 'delivery', deadline },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  )
}
