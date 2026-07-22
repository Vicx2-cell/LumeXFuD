import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { normalizeGroupOrderAddons, groupOrderLineTotalKobo } from '@/lib/group-order-addons'
import { resolveGroupParticipant } from '@/lib/group-order-participant'
import { validateMenuAddonSelection, type MenuAddonChoice } from '@/lib/menu-addon-selection'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GroupRow = {
  id: string
  vendor_id: string
  host_customer_id: string
  status: string
  expires_at: string
  per_person_budget_kobo: number | null
}

const addSchema = z.object({
  client_item_id: z.string().uuid(),
  menu_item_id: z.string().uuid(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).optional(),
  addons: z.array(z.string().uuid()).max(20).optional().default([]),
}).strict()

const updateSchema = z.object({
  item_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).nullable().optional(),
  addons: z.array(z.string().uuid()).max(20).optional().default([]),
}).strict()

async function loadGroup(db: ReturnType<typeof createSupabaseAdmin>, code: string): Promise<GroupRow | null> {
  const { data } = await db.from('group_orders')
    .select('id, vendor_id, host_customer_id, status, expires_at, per_person_budget_kobo')
    .eq('code', code.toUpperCase()).maybeSingle()
  return data as GroupRow | null
}

async function pricedSelection(
  db: ReturnType<typeof createSupabaseAdmin>,
  group: GroupRow,
  menuItemId: string,
  selectedIds: string[],
) {
  const { data: itemRow } = await db.from('menu_items')
    .select('id, name, price_kobo, is_available')
    .eq('id', menuItemId).eq('vendor_id', group.vendor_id).is('deleted_at', null).maybeSingle()
  const item = itemRow as { id: string; name: string; price_kobo: number; is_available: boolean } | null
  if (!item || !item.is_available) return { error: 'That item is not available.' as string, item: null, addons: [] }

  const { data: addonRows } = await db.from('menu_item_addons')
    .select('id, menu_item_id, name, price_kobo, is_available, is_required')
    .eq('menu_item_id', menuItemId).is('deleted_at', null)
  const selection = validateMenuAddonSelection((addonRows ?? []) as MenuAddonChoice[], selectedIds)
  if (selection.error) return { error: selection.error, item: null, addons: [] }
  return { error: null, item, addons: normalizeGroupOrderAddons(selection.selected) }
}

async function participantSubtotal(
  db: ReturnType<typeof createSupabaseAdmin>,
  groupId: string,
  participantId: string,
  excludedItemId?: string,
): Promise<number> {
  const { data } = await db.from('group_order_items')
    .select('id, quantity, addons, menu_items(price_kobo)')
    .eq('group_order_id', groupId).eq('participant_id', participantId)
  return (data ?? []).reduce((sum, record) => {
    const row = record as unknown as { id: string; quantity: number; addons: unknown; menu_items: { price_kobo: number } | null }
    if (row.id === excludedItemId) return sum
    return sum + groupOrderLineTotalKobo({ price_kobo: row.menu_items?.price_kobo ?? 0, quantity: row.quantity, addons: normalizeGroupOrderAddons(row.addons) })
  }, 0)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (session && session.role !== 'customer') return NextResponse.json({ error: 'Customer participants only.' }, { status: 403 })
  if (!(await getFeature('group_orders'))) return NextResponse.json({ error: 'Group ordering is currently unavailable.' }, { status: 503 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const rl = await rateLimitGeneric(`group-add:${session?.phone ?? ip}`, 60, 600)
  if (!rl.success) return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })

  const parsed = addSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 })
  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const db = createSupabaseAdmin()
  const group = await loadGroup(db, code)
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  if (group.status !== 'OPEN' || Date.parse(group.expires_at) <= Date.now()) return NextResponse.json({ error: 'This group order is locked or expired.' }, { status: 409 })

  const actor = await resolveGroupParticipant(db, group.id, code, session)
  if (!actor.participantId || !['JOINED', 'EDITING', 'READY'].includes(actor.status ?? '')) {
    return NextResponse.json({ error: 'Join this group before adding items.', join_required: true }, { status: 401 })
  }

  const priced = await pricedSelection(db, group, parsed.data.menu_item_id, parsed.data.addons)
  if (priced.error || !priced.item) return NextResponse.json({ error: priced.error }, { status: 400 })
  const nextLineTotal = groupOrderLineTotalKobo({ price_kobo: priced.item.price_kobo, quantity: parsed.data.quantity, addons: priced.addons })
  const currentSubtotal = await participantSubtotal(db, group.id, actor.participantId)
  if (group.per_person_budget_kobo !== null && currentSubtotal + nextLineTotal > group.per_person_budget_kobo) {
    return NextResponse.json({ error: 'This contribution exceeds the per-person budget.', budget_exceeded: true }, { status: 409 })
  }

  const { data: result, error } = await db.rpc('group_order_add_item_atomic', {
    p_group_id: group.id,
    p_participant_id: actor.participantId,
    p_contributor_id: actor.customerId,
    p_contributor_name: actor.displayName ?? 'Participant',
    p_menu_item_id: priced.item.id,
    p_unit_price_kobo: priced.item.price_kobo,
    p_quantity: parsed.data.quantity,
    p_notes: parsed.data.notes ?? null,
    p_addons: priced.addons,
    p_client_item_id: parsed.data.client_item_id,
  })
  if (error) return NextResponse.json({ error: 'Could not save this item.' }, { status: 500 })
  if (result !== 'ok') return NextResponse.json({ error: result === 'expired' ? 'This group has expired.' : 'The organizer locked this group while you were editing.', conflict: true }, { status: 409 })

  if (actor.customerId !== group.host_customer_id) void notifyHost(db, group, actor.displayName ?? 'A participant', priced.item.name, parsed.data.quantity)
  return NextResponse.json({ success: true, duplicate_safe: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (session && session.role !== 'customer') return NextResponse.json({ error: 'Customer participants only.' }, { status: 403 })
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 })

  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const db = createSupabaseAdmin()
  const group = await loadGroup(db, code)
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  const actor = await resolveGroupParticipant(db, group.id, code, session)
  if (!actor.participantId) return NextResponse.json({ error: 'Join this group first.' }, { status: 401 })

  const { data: existingRow } = await db.from('group_order_items').select('menu_item_id').eq('id', parsed.data.item_id).eq('group_order_id', group.id).eq('participant_id', actor.participantId).maybeSingle()
  const existing = existingRow as { menu_item_id: string } | null
  if (!existing) return NextResponse.json({ error: 'You can edit only your own contribution.' }, { status: 403 })
  const priced = await pricedSelection(db, group, existing.menu_item_id, parsed.data.addons)
  if (priced.error || !priced.item) return NextResponse.json({ error: priced.error }, { status: 400 })

  const nextLineTotal = groupOrderLineTotalKobo({ price_kobo: priced.item.price_kobo, quantity: parsed.data.quantity, addons: priced.addons })
  const otherSubtotal = await participantSubtotal(db, group.id, actor.participantId, parsed.data.item_id)
  if (group.per_person_budget_kobo !== null && otherSubtotal + nextLineTotal > group.per_person_budget_kobo) {
    return NextResponse.json({ error: 'This contribution exceeds the per-person budget.', budget_exceeded: true }, { status: 409 })
  }

  const { data: result, error } = await db.rpc('group_order_update_item_atomic', {
    p_group_id: group.id,
    p_item_id: parsed.data.item_id,
    p_participant_id: actor.participantId,
    p_unit_price_kobo: priced.item.price_kobo,
    p_quantity: parsed.data.quantity,
    p_notes: parsed.data.notes ?? null,
    p_addons: priced.addons,
    p_expected_version: parsed.data.expected_version,
  })
  if (error) return NextResponse.json({ error: 'Could not update this item.' }, { status: 500 })
  if (result !== 'ok') return NextResponse.json({ error: result === 'conflict' ? 'This item changed in another tab. Refresh and try again.' : 'The group was locked while you were editing.', conflict: true }, { status: 409 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (session && session.role !== 'customer') return NextResponse.json({ error: 'Customer participants only.' }, { status: 403 })
  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const itemId = req.nextUrl.searchParams.get('itemId') ?? ''
  const participantId = req.nextUrl.searchParams.get('participantId') ?? req.nextUrl.searchParams.get('contributorId') ?? ''
  if (!itemId && !participantId) return NextResponse.json({ error: 'Nothing to remove.' }, { status: 400 })

  const db = createSupabaseAdmin()
  const group = await loadGroup(db, code)
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  const actor = await resolveGroupParticipant(db, group.id, code, session)
  const isHost = actor.customerId === group.host_customer_id
  if (!actor.participantId && !isHost) return NextResponse.json({ error: 'Join this group first.' }, { status: 401 })

  if (participantId) {
    if (!isHost) return NextResponse.json({ error: 'Only the organizer can remove a participant.' }, { status: 403 })
    if (participantId === actor.participantId) return NextResponse.json({ error: 'The organizer cannot be removed.' }, { status: 400 })
    if (group.status !== 'OPEN') return NextResponse.json({ error: 'This group is locked.' }, { status: 409 })
    await db.from('group_order_participants').update({ status: 'REMOVED', updated_at: new Date().toISOString() }).eq('id', participantId).eq('group_order_id', group.id)
    await db.from('group_order_items').delete().eq('group_order_id', group.id).eq('participant_id', participantId)
    await db.from('group_order_events').insert({ group_order_id: group.id, actor_participant_id: actor.participantId, event_type: 'participant_removed', metadata: { participant_id: participantId } })
    return NextResponse.json({ success: true })
  }

  const { data: result, error } = await db.rpc('group_order_delete_item_atomic', {
    p_group_id: group.id,
    p_item_id: itemId,
    p_participant_id: actor.participantId,
    p_is_host: isHost,
  })
  if (error) return NextResponse.json({ error: 'Could not remove this item.' }, { status: 500 })
  if (result !== 'ok') return NextResponse.json({ error: result === 'locked' ? 'The group was locked while you were editing.' : 'You can remove only your own contribution.', conflict: true }, { status: 409 })
  return NextResponse.json({ success: true })
}

async function notifyHost(db: ReturnType<typeof createSupabaseAdmin>, group: GroupRow, participantName: string, itemName: string, quantity: number) {
  try {
    const { data: host } = await db.from('customers').select('phone').eq('id', group.host_customer_id).maybeSingle()
    const phone = (host as { phone?: string } | null)?.phone
    if (phone) await sendWhatsAppWithFallback({ to: phone, message: `${participantName} added ${quantity}x ${itemName} to your LumeX group order.` })
  } catch { /* best effort */ }
}
