import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { isBankVerified, BANK_GATE_MESSAGE } from '@/lib/wallet'
import { recordSecurityEvent } from '@/lib/security-events'
import { emailCommittedOrderStatus } from '@/lib/order-status-email'
import { sendAccountNotificationEmail } from '@/lib/transactional-email'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

const acceptInput = z.object({ order_id: z.string().uuid() })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rider', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`rider-accept:${session.userId ?? session.phone}`, 60, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, status, active_order_id, is_active, approval_state')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  if (session.role === 'rider' && rider.id !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rider.is_active) return NextResponse.json({ error: 'Rider account is inactive' }, { status: 403 })
  if (rider.approval_state !== 'approved') return NextResponse.json({ error: 'Rider account is pending review' }, { status: 403 })
  // Mandatory verified bank before a rider can earn (admins/super-admins exempt).
  if (session.role === 'rider' && !(await isBankVerified(id, 'RIDER'))) {
    return NextResponse.json({ error: BANK_GATE_MESSAGE, code: 'BANK_REQUIRED' }, { status: 403 })
  }
  if (rider.status !== 'ONLINE') {
    return NextResponse.json({ error: 'Go online before accepting orders' }, { status: 400 })
  }
  if (rider.active_order_id) {
    return NextResponse.json({ error: 'Complete your current delivery first' }, { status: 400 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = acceptInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid order_id' }, { status: 400 })

  const now = new Date().toISOString()

  const { data, error } = await db.rpc('accept_rider_order', {
    p_rider_id: id, p_order_id: parsed.data.order_id, p_now: now,
  })
  const updated = (data as Array<{ success: boolean; error_code: string | null; order_number: string; vendor_id: string }> | null)?.[0]
  if (error || !updated?.success) {
    await recordSecurityEvent({
      eventType: 'rider_assignment_rejected', severity: 'warn', surface: 'riders.accept',
      actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
      ip: req.headers.get('x-forwarded-for'), userAgent: req.headers.get('user-agent'),
      requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, resourceType: 'order',
      resourceId: parsed.data.order_id, outcome: updated?.error_code ?? 'rpc_error',
      detail: { rider_id: id, error_code: updated?.error_code ?? 'RPC_ERROR' },
    })
    return json({ error: 'Order no longer available' }, { status: 409 })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'rider_accepted_order',
    target_table: 'orders',
    target_id: parsed.data.order_id,
    new_value: { rider_id: id, status: 'RIDER_ASSIGNED' },
  })

  void recordSecurityEvent({
    eventType: 'rider_order_accepted',
    severity: 'info',
    surface: 'riders.accept',
    actorId: session.userId ?? null,
    actorRole: session.role,
    sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
    requestId: context.requestId,
    correlationId: context.correlationId,
    route: req.nextUrl.pathname,
    method: req.method,
    resourceType: 'order',
    resourceId: parsed.data.order_id,
    outcome: 'assigned',
    detail: {
      order_id: parsed.data.order_id,
      order_number: updated.order_number,
      vendor_id: updated.vendor_id,
      rider_id: id,
      from_status: 'READY',
      to_status: 'RIDER_ASSIGNED',
      status_changed_at: now,
    },
  })

  await emailCommittedOrderStatus(db, {
    orderId: parsed.data.order_id,
    status: 'RIDER_ASSIGNED',
    actorType: session.role,
    actorId: session.userId ?? session.phone,
  })
  void sendAccountNotificationEmail(db, {
    role: 'rider',
    accountId: id,
    eventKey: `rider-order-assigned:${parsed.data.order_id}`,
    title: `Delivery assigned: ${updated.order_number}`,
    body: 'You accepted this delivery. Open the rider desk for the pickup and drop-off details.',
    actionLabel: 'Open delivery',
    actionUrl: 'https://lumexfud.com.ng/rider',
  }).catch(() => {})

  return json({ success: true, order_number: updated.order_number })
}
