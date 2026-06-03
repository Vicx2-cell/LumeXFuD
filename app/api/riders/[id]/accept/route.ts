import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

const acceptInput = z.object({ order_id: z.string().uuid() })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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
    .select('id, status, active_order_id, is_active')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  if (session.role === 'rider' && rider.id !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rider.is_active) return NextResponse.json({ error: 'Rider account is inactive' }, { status: 403 })
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

  // Race-safe: only update if status=READY and rider_id IS NULL
  const { data: updated, error } = await db
    .from('orders')
    .update({
      rider_id: id,
      status: 'RIDER_ASSIGNED',
      rider_assigned_at: now,
      updated_at: now,
    })
    .eq('id', parsed.data.order_id)
    .eq('status', 'READY')
    .is('rider_id', null)
    .select('id, order_number')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: 'Order no longer available' }, { status: 409 })
  }

  await db.from('riders').update({
    status: 'BUSY',
    active_order_id: parsed.data.order_id,
    last_status_update_at: now,
  }).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'rider_accepted_order',
    target_table: 'orders',
    target_id: parsed.data.order_id,
    new_value: { rider_id: id, status: 'RIDER_ASSIGNED' },
  })

  return NextResponse.json({ success: true, order_number: updated.order_number })
}
