import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { recordSecurityEvent } from '@/lib/security-events'
import { emailCommittedOrderStatus } from '@/lib/order-status-email'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

export const runtime = 'nodejs'

const input = z.object({
  rider_id: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
})

const ERROR_STATUS: Record<string, [number, string]> = {
  ORDER_NOT_REASSIGNABLE: [409, 'Order is not ready for rider reassignment'],
  ORDER_NOT_PAID: [400, 'Order is not paid'],
  RIDER_NOT_FOUND: [404, 'Rider not found'],
  RIDER_INACTIVE: [403, 'Rider is inactive or not approved'],
  RIDER_NOT_ONLINE: [400, 'Rider must be online before assignment'],
  RIDER_BUSY: [409, 'Rider already has an active order'],
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) return json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`rider-reassign:${session.userId ?? session.phone}`, 40, 300, true)
  if (!rl.success) return json({ error: 'Too many reassignment attempts. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = input.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await db.rpc('admin_reassign_order_rider', {
    p_order_id: id,
    p_new_rider_id: parsed.data.rider_id,
    p_now: now,
  })
  if (error) return json({ error: 'Could not reassign rider' }, { status: 500 })

  const row = (data as Array<{ success: boolean; error_code: string | null; order_number: string | null; previous_rider_id: string | null }> | null)?.[0]
  if (!row?.success) {
    const [status, message] = ERROR_STATUS[row?.error_code ?? ''] ?? [409, 'Rider reassignment failed']
    return json({ error: message, code: row?.error_code ?? 'REASSIGNMENT_FAILED' }, { status })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'order_rider_reassigned',
    target_table: 'orders',
    target_id: id,
    old_value: { rider_id: row.previous_rider_id },
    new_value: { rider_id: parsed.data.rider_id, reason: parsed.data.reason },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    user_agent: req.headers.get('user-agent') ?? undefined,
  })

  await db.from('support_notes').insert({
    subject_type: 'order',
    subject_id: id,
    note: `Rider reassigned: ${parsed.data.reason}`,
    pinned: false,
    created_by: session.phone,
    created_by_role: session.role,
  })

  void recordSecurityEvent({
    eventType: 'order_rider_reassigned',
    severity: 'info',
    surface: 'admin.orders.reassign_rider',
    actorId: session.userId ?? session.phone,
    actorRole: session.role,
    sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
    requestId: context.requestId,
    correlationId: context.correlationId,
    route: req.nextUrl.pathname,
    method: req.method,
    resourceType: 'order',
    resourceId: id,
    outcome: 'reassigned',
    detail: { order_number: row.order_number, previous_rider_id: row.previous_rider_id, rider_id: parsed.data.rider_id },
  })

  await emailCommittedOrderStatus(db, {
    orderId: id,
    status: 'RIDER_ASSIGNED',
    actorType: session.role,
    actorId: session.userId ?? session.phone,
  })

  return json({
    success: true,
    order_number: row.order_number,
    previous_rider_id: row.previous_rider_id,
    rider_id: parsed.data.rider_id,
  })
}
