import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { reconcileGroupOrder } from '@/lib/group-order-reconciliation'

const input = z.object({
  action: z.enum(['lock', 'unlock']).default('lock'),
  expected_version: z.number().int().positive(),
}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return NextResponse.json({ error: 'Organizer authentication required.' }, { status: 401 })
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid lock request.' }, { status: 400 })
  const rl = await rateLimitGeneric(`group-lock:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many lock requests.' }, { status: 429 })

  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const db = createSupabaseAdmin()
  const { data: customerRow } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  const customerId = (customerRow as { id?: string } | null)?.id
  if (!customerId) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
  const { data: groupRow } = await db.from('group_orders').select(
    'id, host_customer_id, vendor_id, status, expires_at, per_person_budget_kobo, version, reconciliation, placed_order_id',
  ).eq('code', code).maybeSingle()
  const group = groupRow as {
    id: string
    host_customer_id: string
    vendor_id: string
    status: string
    expires_at: string
    per_person_budget_kobo: number | null
    version: number
    reconciliation: unknown
    placed_order_id: string | null
  } | null
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  if (group.host_customer_id !== customerId) return NextResponse.json({ error: 'Only the organizer can lock this group.' }, { status: 403 })

  if (parsed.data.action === 'unlock') {
    if (!['LOCKED', 'FAILED', 'AWAITING_PAYMENT'].includes(group.status) || group.placed_order_id) return NextResponse.json({ error: 'This group cannot be reopened.' }, { status: 409 })
    if (group.status === 'AWAITING_PAYMENT') {
      const { count: existingOrders } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('group_order_id', group.id)
      if (existingOrders) return NextResponse.json({ error: 'Payment has already started. Continue from the existing cart instead.' }, { status: 409 })
    }
    const { data: reopened } = await db.from('group_orders').update({ status: 'OPEN', locked_at: null, reconciliation: [], version: group.version + 1 })
      .eq('id', group.id).eq('status', group.status).select('id')
    if (!reopened?.length) return NextResponse.json({ error: 'The group changed in another tab. Refresh first.', conflict: true }, { status: 409 })
    await db.from('group_order_events').insert({ group_order_id: group.id, actor_customer_id: customerId, event_type: 'group_reopened' })
    return NextResponse.json({ success: true, status: 'OPEN', version: group.version + 1 })
  }

  const { data: lockResult, error: lockError } = await db.rpc('group_order_begin_lock', {
    p_group_id: group.id,
    p_host_customer_id: customerId,
    p_expected_version: parsed.data.expected_version,
  })
  if (lockError) return NextResponse.json({ error: 'Could not lock this group.' }, { status: 500 })
  if (lockResult === 'already_locked') {
    return NextResponse.json({ success: true, status: group.status, version: group.version, reconciliation: Array.isArray(group.reconciliation) ? group.reconciliation : [], repeated: true })
  }
  if (lockResult !== 'ok') {
    const message = lockResult === 'conflict' ? 'The group changed in another tab. Refresh before locking.' : lockResult === 'expired' ? 'This group has expired.' : 'This group cannot be locked.'
    return NextResponse.json({ error: message, conflict: lockResult === 'conflict' }, { status: 409 })
  }

  const [{ data: vendorRow }, { data: participants }, { data: items }, { data: menuItems }, { data: addonRows }] = await Promise.all([
    db.from('vendors').select('is_active, approval_state, status').eq('id', group.vendor_id).maybeSingle(),
    db.from('group_order_participants').select('id, status').eq('group_order_id', group.id).in('status', ['JOINED', 'EDITING', 'READY']),
    db.from('group_order_items').select('id, participant_id, menu_item_id, unit_price_kobo, quantity, addons').eq('group_order_id', group.id),
    db.from('menu_items').select('id, name, price_kobo, is_available').eq('vendor_id', group.vendor_id).is('deleted_at', null),
    db.from('menu_item_addons').select('id, menu_item_id, name, price_kobo, is_available').is('deleted_at', null),
  ])
  const vendor = vendorRow as { is_active?: boolean; approval_state?: string; status?: string } | null
  const currentItems = new Map((menuItems ?? []).map((record) => {
    const row = record as { id: string; name: string; price_kobo: number; is_available: boolean }
    return [row.id, { name: row.name, price_kobo: Number(row.price_kobo), is_available: row.is_available }]
  }))
  const currentAddons = new Map((addonRows ?? []).map((record) => {
    const row = record as { id: string; menu_item_id: string; name: string; price_kobo: number; is_available: boolean }
    return [row.id, { name: row.name, price_kobo: Number(row.price_kobo), is_available: row.is_available, menu_item_id: row.menu_item_id }]
  }))
  const issues = reconcileGroupOrder({
    vendorAvailable: Boolean(vendor?.is_active && vendor.approval_state === 'approved' && vendor.status !== 'CLOSED'),
    budgetKobo: group.per_person_budget_kobo,
    participants: (participants ?? []) as Array<{ id: string; status: string }>,
    items: (items ?? []).map((record) => {
      const row = record as { id: string; participant_id: string | null; menu_item_id: string; unit_price_kobo: number | null; quantity: number; addons: unknown }
      return { ...row, participant_id: row.participant_id ?? '', unit_price_kobo: Number(row.unit_price_kobo ?? currentItems.get(row.menu_item_id)?.price_kobo ?? 0) }
    }),
    currentItems,
    currentAddons,
  })

  const nextVersion = group.version + 1
  const { data: finalized } = await db.from('group_orders').update({ status: 'LOCKED', reconciliation: issues })
    .eq('id', group.id).eq('status', 'VALIDATING').select('id')
  if (!finalized?.length) return NextResponse.json({ error: 'Lock reconciliation lost a concurrent update.', conflict: true }, { status: 409 })
  await db.from('group_order_events').insert({ group_order_id: group.id, actor_customer_id: customerId, event_type: issues.length ? 'lock_conflicts_found' : 'group_locked', metadata: { issue_count: issues.length } })
  return NextResponse.json({ success: true, status: 'LOCKED', version: nextVersion, reconciliation: issues })
}
