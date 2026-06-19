import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { generateGroupCode } from '@/lib/group-order'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/group-order/create — a logged-in customer starts a group order for a
// vendor, optionally seeding it with their current cart. Returns the share code.
const schema = z.object({
  vendor_id: z.string().uuid(),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().positive().max(20),
    notes: z.string().max(200).optional(),
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

  const db = createSupabaseAdmin()

  const { data: vendor } = await db
    .from('vendors').select('id, name, is_active').eq('id', parsed.data.vendor_id).is('deleted_at', null).maybeSingle()
  const v = vendor as { id: string; name: string | null; is_active: boolean } | null
  if (!v || !v.is_active) return NextResponse.json({ error: 'Vendor is not available.' }, { status: 404 })

  const { data: cust } = await db.from('customers').select('id, name').eq('phone', session.phone).is('deleted_at', null).maybeSingle()
  const customer = cust as { id: string; name: string | null } | null
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Validate any seed items belong to this vendor + are available (server-side).
  let seedRows: Array<{ menu_item_id: string; quantity: number; notes: string | null }> = []
  if (parsed.data.items && parsed.data.items.length > 0) {
    const ids = parsed.data.items.map((i) => i.menu_item_id)
    const { data: menu } = await db.from('menu_items')
      .select('id, is_available').in('id', ids).eq('vendor_id', v.id).is('deleted_at', null)
    const ok = new Set((menu ?? []).filter((m) => (m as { is_available: boolean }).is_available).map((m) => (m as { id: string }).id))
    seedRows = parsed.data.items
      .filter((i) => ok.has(i.menu_item_id))
      .map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity, notes: i.notes ?? null }))
  }

  // Insert the group, retrying once on the rare code collision.
  let code = ''
  let groupId = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    code = generateGroupCode()
    const { data, error } = await db.from('group_orders')
      .insert({ code, vendor_id: v.id, host_customer_id: customer.id })
      .select('id').single()
    if (!error && data) { groupId = (data as { id: string }).id; break }
    if (error && error.code !== '23505') {
      return NextResponse.json({ error: 'Could not start group order' }, { status: 500 })
    }
  }
  if (!groupId) return NextResponse.json({ error: 'Could not start group order' }, { status: 500 })

  if (seedRows.length > 0) {
    await db.from('group_order_items').insert(seedRows.map((r) => ({
      group_order_id: groupId,
      contributor_id: customer.id,
      contributor_name: customer.name ?? null,
      menu_item_id: r.menu_item_id,
      quantity: r.quantity,
      notes: r.notes,
    })))
  }

  return NextResponse.json({ code })
}
