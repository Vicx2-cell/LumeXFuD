import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function loadOpenGroup(db: ReturnType<typeof createSupabaseAdmin>, code: string) {
  const { data } = await db
    .from('group_orders')
    .select('id, vendor_id, host_customer_id, status, expires_at')
    .eq('code', code.toUpperCase())
    .maybeSingle()
  return data as { id: string; vendor_id: string; host_customer_id: string; status: string; expires_at: string } | null
}

async function me(db: ReturnType<typeof createSupabaseAdmin>, phone: string) {
  const { data } = await db.from('customers').select('id, name').eq('phone', phone).maybeSingle()
  return data as { id: string; name: string | null } | null
}

const addSchema = z.object({
  menu_item_id: z.string().uuid(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).optional(),
}).strict()

// POST /api/group-order/[code]/items — a logged-in customer adds their item.
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`group-add:${session.userId ?? session.phone}`, 60, 600)
  if (!rl.success) return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })

  const { code } = await params
  const body = await req.json().catch(() => null)
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const db = createSupabaseAdmin()
  const group = await loadOpenGroup(db, code)
  if (!group) return NextResponse.json({ error: 'Group order not found' }, { status: 404 })
  if (group.status !== 'OPEN' || new Date(group.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This group order is closed.' }, { status: 409 })
  }

  // The item must belong to this group's vendor and be available (server-side).
  const { data: mi } = await db.from('menu_items')
    .select('id, is_available').eq('id', parsed.data.menu_item_id).eq('vendor_id', group.vendor_id).is('deleted_at', null).maybeSingle()
  const item = mi as { id: string; is_available: boolean } | null
  if (!item || !item.is_available) return NextResponse.json({ error: 'That item is not available.' }, { status: 400 })

  if (!(await getFeature('group_orders'))) {
    return NextResponse.json({ error: 'Group ordering is currently unavailable.' }, { status: 503 })
  }

  const customer = await me(db, session.phone)
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { error } = await db.from('group_order_items').insert({
    group_order_id: group.id,
    contributor_id: customer.id,
    contributor_name: customer.name ?? null,
    menu_item_id: parsed.data.menu_item_id,
    quantity: parsed.data.quantity,
    notes: parsed.data.notes ?? null,
  })
  if (error) return NextResponse.json({ error: 'Could not add item' }, { status: 500 })

  // Let the host know someone joined/added (best-effort; not for the host's own adds).
  if (customer.id !== group.host_customer_id) {
    try {
      const [{ data: hostRow }, { data: mi2 }] = await Promise.all([
        db.from('customers').select('phone').eq('id', group.host_customer_id).maybeSingle(),
        db.from('menu_items').select('name').eq('id', parsed.data.menu_item_id).maybeSingle(),
      ])
      const hostPhone = (hostRow as { phone: string } | null)?.phone
      const itemName = (mi2 as { name: string } | null)?.name ?? 'an item'
      if (hostPhone) {
        void sendWhatsAppWithFallback({
          to: hostPhone,
          message: `🛒 ${customer.name ?? 'A friend'} added ${parsed.data.quantity}× ${itemName} to your LumeX group order.`,
        }).catch(() => {})
      }
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/group-order/[code]/items?itemId=… — remove your own item (or the host removes any).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { code } = await params
  const itemId = req.nextUrl.searchParams.get('itemId') ?? ''
  if (!itemId) return NextResponse.json({ error: 'Missing item' }, { status: 400 })

  const db = createSupabaseAdmin()
  const group = await loadOpenGroup(db, code)
  if (!group) return NextResponse.json({ error: 'Group order not found' }, { status: 404 })

  const customer = await me(db, session.phone)
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: row } = await db.from('group_order_items').select('id, contributor_id').eq('id', itemId).eq('group_order_id', group.id).maybeSingle()
  const it = row as { id: string; contributor_id: string } | null
  if (!it) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  // Only the contributor or the host may remove an item.
  if (it.contributor_id !== customer.id && group.host_customer_id !== customer.id) {
    return NextResponse.json({ error: 'You can only remove your own items.' }, { status: 403 })
  }

  await db.from('group_order_items').delete().eq('id', it.id)
  return NextResponse.json({ success: true })
}
