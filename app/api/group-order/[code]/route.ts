import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { groupOrderLineTotalKobo, normalizeGroupOrderAddons } from '@/lib/group-order-addons'
import { resolveGroupParticipant } from '@/lib/group-order-participant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (session && session.role !== 'customer') return NextResponse.json({ error: 'Customer participants only.' }, { status: 403 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const rl = await rateLimitGeneric(`group-view:${session?.phone ?? ip}`, 90, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const db = createSupabaseAdmin()
  const { data: groupRow } = await db.from('group_orders').select(
    'id, code, name, vendor_id, host_customer_id, status, expires_at, delivery_type, delivery_address, per_person_budget_kobo, participant_limit, shared_note, version, reconciliation',
  ).eq('code', code).maybeSingle()
  const group = groupRow as {
    id: string
    code: string
    name: string | null
    vendor_id: string
    host_customer_id: string
    status: string
    expires_at: string
    delivery_type: string
    delivery_address: string | null
    per_person_budget_kobo: number | null
    participant_limit: number
    shared_note: string | null
    version: number
    reconciliation: unknown
  } | null
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })

  const expired = Date.parse(group.expires_at) <= Date.now()
  if (expired && group.status === 'OPEN') {
    await db.from('group_orders').update({ status: 'EXPIRED', version: group.version + 1 }).eq('id', group.id).eq('status', 'OPEN')
    group.status = 'EXPIRED'
  }

  const [{ data: vendorRow }, { data: hostRow }] = await Promise.all([
    db.from('vendors').select('id, shop_name, status, is_active, approval_state').eq('id', group.vendor_id).maybeSingle(),
    db.from('customers').select('id, name').eq('id', group.host_customer_id).maybeSingle(),
  ])
  const vendor = vendorRow as { id: string; shop_name: string | null; status: string; is_active: boolean; approval_state: string } | null
  const host = hostRow as { id: string; name: string | null } | null
  const actor = await resolveGroupParticipant(db, group.id, code, session)
  const isHost = actor.customerId === group.host_customer_id
  const activeActor = isHost || (actor.participantId && ['JOINED', 'EDITING', 'READY'].includes(actor.status ?? ''))

  const summary = {
    code: group.code,
    group_order_id: group.id,
    name: group.name ?? 'Group order',
    status: group.status,
    expires_at: group.expires_at,
    delivery_type: group.delivery_type,
    delivery_address: group.delivery_address,
    per_person_budget_kobo: group.per_person_budget_kobo,
    participant_limit: group.participant_limit,
    shared_note: group.shared_note,
    organizer: { id: group.host_customer_id, name: host?.name ?? 'Organizer' },
    vendor: { id: group.vendor_id, name: vendor?.shop_name ?? 'Vendor', status: vendor?.status ?? 'CLOSED' },
    version: group.version,
    reconciliation: normalizeReconciliation(group.reconciliation),
  }

  if (!activeActor) {
    return NextResponse.json({ ...summary, join_required: true, is_host: false })
  }

  await db.from('group_order_participants').update({ last_seen_at: new Date().toISOString() }).eq('id', actor.participantId ?? '')
  const [{ data: participants }, { data: items }, { data: menu }] = await Promise.all([
    db.from('group_order_participants')
      .select('id, customer_id, display_name, status, joined_at, last_seen_at')
      .eq('group_order_id', group.id)
      .order('joined_at', { ascending: true }),
    db.from('group_order_items')
      .select('id, participant_id, contributor_id, contributor_name, quantity, notes, addons, menu_item_id, unit_price_kobo, version, menu_items(name, price_kobo, is_available)')
      .eq('group_order_id', group.id)
      .order('created_at', { ascending: true }),
    db.from('menu_items')
      .select('id, name, price_kobo, category, is_available, menu_item_addons(id, name, price_kobo, is_available, is_required, display_order)')
      .eq('vendor_id', group.vendor_id)
      .eq('is_available', true)
      .is('deleted_at', null)
      .order('display_order', { ascending: true }),
  ])

  const itemRows = (items ?? []).map((record) => {
    const row = record as unknown as {
      id: string
      participant_id: string | null
      contributor_id: string | null
      contributor_name: string | null
      quantity: number
      notes: string | null
      addons: unknown
      menu_item_id: string
      unit_price_kobo: number | null
      version: number
      menu_items: { name: string; price_kobo: number; is_available: boolean } | null
    }
    const ownerKey = row.participant_id ?? row.contributor_id ?? ''
    return {
      id: row.id,
      participant_id: row.participant_id,
      contributor_id: ownerKey,
      contributor_name: row.contributor_name ?? 'Participant',
      quantity: row.quantity,
      notes: row.notes,
      menu_item_id: row.menu_item_id,
      name: row.menu_items?.name ?? 'Unavailable item',
      price_kobo: row.unit_price_kobo ?? row.menu_items?.price_kobo ?? 0,
      current_price_kobo: row.menu_items?.price_kobo ?? 0,
      available: Boolean(row.menu_items?.is_available),
      addons: normalizeGroupOrderAddons(row.addons),
      version: row.version,
      mine: ownerKey === (actor.participantId ?? actor.customerId),
    }
  })

  const totals = new Map<string, number>()
  for (const item of itemRows) totals.set(item.contributor_id, (totals.get(item.contributor_id) ?? 0) + groupOrderLineTotalKobo(item))

  return NextResponse.json({
    ...summary,
    join_required: false,
    is_host: isHost,
    participant_id: actor.participantId,
    participant_status: actor.status,
    participants: (participants ?? []).map((record) => {
      const row = record as { id: string; customer_id: string | null; display_name: string; status: string; joined_at: string; last_seen_at: string }
      return { ...row, subtotal_kobo: totals.get(row.id) ?? totals.get(row.customer_id ?? '') ?? 0, mine: row.id === actor.participantId }
    }),
    items: itemRows,
    menu: group.status === 'OPEN' ? (menu ?? []).map((record) => {
      const row = record as unknown as {
        id: string
        name: string
        price_kobo: number
        category: string
        menu_item_addons?: Array<{ id: string; name: string; price_kobo: number; is_available: boolean; is_required: boolean; display_order: number }>
      }
      return {
        id: row.id,
        name: row.name,
        price_kobo: row.price_kobo,
        category: row.category,
        addons: (row.menu_item_addons ?? []).filter((addon) => addon.is_available).sort((a, b) => a.display_order - b.display_order),
      }
    }) : [],
  })
}

export async function PATCH() {
  return NextResponse.json({ error: 'Participant-paid split billing is not supported for this group-order model.' }, { status: 409 })
}

function normalizeReconciliation(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
