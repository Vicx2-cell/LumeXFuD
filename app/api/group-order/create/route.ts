import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { generateGroupCode } from '@/lib/group-order'
import { getFeature } from '@/lib/features'
import { trackFeature } from '@/lib/usage'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { normalizeGroupOrderAddons } from '@/lib/group-order-addons'
import { validateGroupDeadline } from '@/lib/group-order-state'
import { validateMenuAddonSelection, type MenuAddonChoice } from '@/lib/menu-addon-selection'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/group-order/create — a logged-in customer starts a group order for a
// vendor, optionally seeding it with their current cart. Returns the share code.
const schema = z.object({
  vendor_id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  delivery_address: z.string().trim().min(5).max(500),
  delivery_type: z.enum(['BIKE', 'DOOR', 'PICKUP']).default('BIKE'),
  deadline: z.string().datetime().optional(),
  per_person_budget_kobo: z.number().int().positive().max(10_000_000).nullable().optional(),
  participant_limit: z.number().int().min(2).max(20).default(8),
  shared_note: z.string().trim().max(300).optional(),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().positive().max(20),
    notes: z.string().max(200).optional(),
    addons: z.array(z.string().uuid()).max(20).optional().default([]),
  })).max(50).optional(),
}).strict()

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Only customers can start a group order.' }, { status: 403 })

  if (!(await getFeature('group_orders'))) {
    return NextResponse.json({ error: 'Group ordering is currently unavailable.' }, { status: 503 })
  }

  const rl = await rateLimitGeneric(`group-create:${session.userId ?? session.phone}`, 15, 600)
  if (!rl.success) return NextResponse.json({ error: 'Too many group orders. Slow down.' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const deadline = parsed.data.deadline ?? new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
  const deadlineError = validateGroupDeadline(deadline)
  if (deadlineError) return NextResponse.json({ error: deadlineError }, { status: 400 })

  const db = createSupabaseAdmin()

  const { data: vendor } = await db
    .from('vendors').select('id, shop_name, is_active, approval_state, status').eq('id', parsed.data.vendor_id).is('deleted_at', null).maybeSingle()
  const v = vendor as { id: string; shop_name: string | null; is_active: boolean; approval_state: string; status: string } | null
  if (!v || !v.is_active || v.approval_state !== 'approved') return NextResponse.json({ error: 'Vendor is not available.' }, { status: 404 })
  if (v.status === 'CLOSED') return NextResponse.json({ error: 'Vendor is currently closed.' }, { status: 409 })

  const { data: cust } = await db.from('customers').select('id, name, phone_verified').eq('phone', session.phone).is('deleted_at', null).maybeSingle()
  const customer = cust as { id: string; name: string | null; phone_verified: boolean } | null
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (!customer.phone_verified) return NextResponse.json({ error: 'Verify your phone before starting a group order.' }, { status: 403 })

  // Validate any seed items belong to this vendor + are available (server-side).
  let seedRows: Array<{ menu_item_id: string; unit_price_kobo: number; quantity: number; notes: string | null; addons: ReturnType<typeof normalizeGroupOrderAddons>; selectionError: string | null }> = []
  if (parsed.data.items && parsed.data.items.length > 0) {
    const ids = parsed.data.items.map((i) => i.menu_item_id)
    const { data: menu } = await db.from('menu_items')
      .select('id, price_kobo, is_available').in('id', ids).eq('vendor_id', v.id).is('deleted_at', null)
    const ok = new Set((menu ?? []).filter((m) => (m as { is_available: boolean }).is_available).map((m) => (m as { id: string }).id))
    const priceByItem = new Map((menu ?? []).map((m) => [(m as { id: string }).id, Number((m as { price_kobo: number }).price_kobo)]))
    const { data: addons } = await db.from('menu_item_addons')
      .select('id, menu_item_id, name, price_kobo, is_available, is_required')
      .in('menu_item_id', ids)
      .is('deleted_at', null)
    const addonsByItem = new Map<string, MenuAddonChoice[]>()
    for (const addon of (addons ?? []) as MenuAddonChoice[]) {
      const current = addonsByItem.get(addon.menu_item_id) ?? []
      current.push(addon)
      addonsByItem.set(addon.menu_item_id, current)
    }
    seedRows = parsed.data.items
      .filter((i) => ok.has(i.menu_item_id))
      .map((i) => {
        const selection = validateMenuAddonSelection(addonsByItem.get(i.menu_item_id) ?? [], i.addons ?? [])
        return {
          menu_item_id: i.menu_item_id,
          unit_price_kobo: priceByItem.get(i.menu_item_id) ?? 0,
          quantity: i.quantity,
          notes: i.notes ?? null,
          addons: selection.error ? [] : normalizeGroupOrderAddons(selection.selected),
          selectionError: selection.error,
        }
      })
    if (seedRows.some((row) => row.selectionError)) {
      return NextResponse.json({ error: seedRows.find((row) => row.selectionError)?.selectionError }, { status: 400 })
    }
    const requestedValidAddons = parsed.data.items
      .filter((i) => ok.has(i.menu_item_id))
      .reduce((sum, item) => sum + new Set(item.addons ?? []).size, 0)
    const acceptedAddons = seedRows.reduce((sum, item) => sum + item.addons.length, 0)
    if (acceptedAddons !== requestedValidAddons) {
      return NextResponse.json({ error: 'One or more add-ons are invalid or unavailable.' }, { status: 400 })
    }
  }

  // Insert the group, retrying once on the rare code collision.
  let code = ''
  let groupId = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    code = generateGroupCode()
    const { data, error } = await db.from('group_orders')
      // Short, explicit window — a meal group is decided fast; the link auto-closes
      // in 3h (the page shows a countdown; adds/checkout are refused after).
      .insert({
        code,
        vendor_id: v.id,
        host_customer_id: customer.id,
        name: parsed.data.name ?? `${customer.name?.split(/\s+/)[0] ?? 'Friends'} group`,
        delivery_type: parsed.data.delivery_type,
        delivery_address: parsed.data.delivery_address,
        per_person_budget_kobo: parsed.data.per_person_budget_kobo ?? null,
        participant_limit: parsed.data.participant_limit,
        shared_note: parsed.data.shared_note ?? null,
        expires_at: deadline,
        split_enabled: false,
        status: 'OPEN',
      })
      .select('id').single()
    if (!error && data) { groupId = (data as { id: string }).id; break }
    if (error && error.code !== '23505') {
      return NextResponse.json({ error: 'Could not start group order' }, { status: 500 })
    }
  }
  if (!groupId) return NextResponse.json({ error: 'Could not start group order' }, { status: 500 })

  const { data: hostParticipant, error: participantError } = await db.from('group_order_participants').insert({
    group_order_id: groupId,
    customer_id: customer.id,
    display_name: customer.name ?? 'Organizer',
    status: seedRows.length > 0 ? 'EDITING' : 'JOINED',
  }).select('id').single()
  if (participantError || !hostParticipant) {
    await db.from('group_orders').delete().eq('id', groupId)
    return NextResponse.json({ error: 'Could not initialize organizer.' }, { status: 500 })
  }

  if (seedRows.length > 0) {
    const { error: seedError } = await db.from('group_order_items').insert(seedRows.map((r) => ({
      group_order_id: groupId,
      participant_id: hostParticipant.id,
      contributor_id: customer.id,
      contributor_name: customer.name ?? null,
      menu_item_id: r.menu_item_id,
      unit_price_kobo: r.unit_price_kobo,
      quantity: r.quantity,
      notes: r.notes,
      addons: r.addons,
      client_item_id: randomUUID(),
    })))
    if (seedError) {
      await db.from('group_orders').delete().eq('id', groupId)
      return NextResponse.json({ error: 'Could not seed the organizer contribution.' }, { status: 500 })
    }
  }

  trackFeature('group_orders', 'customer')
  return NextResponse.json({ code, status: 'OPEN' })
}
