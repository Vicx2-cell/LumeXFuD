import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const input = z.object({ expected_version: z.number().int().positive() }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return NextResponse.json({ error: 'Organizer authentication required.' }, { status: 401 })
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid checkout request.' }, { status: 400 })

  const { code: rawCode } = await params
  const db = createSupabaseAdmin()
  const { data: customerRow } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  const customerId = (customerRow as { id?: string } | null)?.id
  const { data: groupRow } = await db.from('group_orders')
    .select('id, host_customer_id, status, version, reconciliation, expires_at')
    .eq('code', rawCode.toUpperCase()).maybeSingle()
  const group = groupRow as { id: string; host_customer_id: string; status: string; version: number; reconciliation: unknown; expires_at: string } | null
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  if (!customerId || group.host_customer_id !== customerId) return NextResponse.json({ error: 'Only the organizer can continue to checkout.' }, { status: 403 })
  if (group.status === 'AWAITING_PAYMENT') return NextResponse.json({ success: true, status: group.status, version: group.version, repeated: true })
  if (group.status !== 'LOCKED' || Date.parse(group.expires_at) <= Date.now()) return NextResponse.json({ error: 'Lock and reconcile this group before checkout.' }, { status: 409 })
  if (group.version !== parsed.data.expected_version) return NextResponse.json({ error: 'The group changed in another tab. Refresh first.', conflict: true }, { status: 409 })
  if (Array.isArray(group.reconciliation) && group.reconciliation.length > 0) return NextResponse.json({ error: 'Resolve reconciliation changes before checkout.' }, { status: 409 })

  const { count } = await db.from('group_order_items').select('id', { count: 'exact', head: true }).eq('group_order_id', group.id)
  if (!count) return NextResponse.json({ error: 'The group has no items.' }, { status: 409 })
  const nextVersion = group.version + 1
  const { data: updated } = await db.from('group_orders').update({ status: 'AWAITING_PAYMENT', version: nextVersion })
    .eq('id', group.id).eq('status', 'LOCKED').eq('version', group.version).select('id')
  if (!updated?.length) return NextResponse.json({ error: 'The group changed in another tab. Refresh first.', conflict: true }, { status: 409 })
  await db.from('group_order_events').insert({ group_order_id: group.id, actor_customer_id: customerId, event_type: 'checkout_started' })
  return NextResponse.json({ success: true, status: 'AWAITING_PAYMENT', version: nextVersion })
}
