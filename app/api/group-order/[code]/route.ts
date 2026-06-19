import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/group-order/[code] — the shared group view: vendor, the running item
// list (who added what, with live menu prices), the available menu for adding
// more, and whether the caller is the host. Logged-in customers only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { code } = await params
  const db = createSupabaseAdmin()

  const { data: g } = await db
    .from('group_orders')
    .select('id, code, vendor_id, host_customer_id, status, expires_at')
    .eq('code', code.toUpperCase())
    .maybeSingle()
  const group = g as { id: string; code: string; vendor_id: string; host_customer_id: string; status: string; expires_at: string } | null
  if (!group) return NextResponse.json({ error: 'Group order not found' }, { status: 404 })
  if (new Date(group.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This group order has expired.', expired: true }, { status: 410 })
  }

  const { data: me } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  const myId = (me as { id: string } | null)?.id ?? ''

  const [{ data: vendor }, { data: menu }, { data: items }] = await Promise.all([
    db.from('vendors').select('id, name').eq('id', group.vendor_id).maybeSingle(),
    db.from('menu_items').select('id, name, price_kobo, category').eq('vendor_id', group.vendor_id).eq('is_available', true).is('deleted_at', null).order('display_order', { ascending: true }),
    db.from('group_order_items')
      .select('id, contributor_id, contributor_name, quantity, notes, menu_item_id, menu_items(name, price_kobo)')
      .eq('group_order_id', group.id)
      .order('created_at', { ascending: true }),
  ])

  const v = vendor as { id: string; name: string | null } | null
  const itemRows = (items ?? []).map((r) => {
    const row = r as unknown as { id: string; contributor_id: string; contributor_name: string | null; quantity: number; notes: string | null; menu_item_id: string; menu_items: { name: string; price_kobo: number } | null }
    return {
      id: row.id,
      contributor_id: row.contributor_id,
      contributor_name: row.contributor_name ?? 'Someone',
      quantity: row.quantity,
      notes: row.notes,
      menu_item_id: row.menu_item_id,
      name: row.menu_items?.name ?? 'Item',
      price_kobo: row.menu_items?.price_kobo ?? 0,
      mine: row.contributor_id === myId,
    }
  })

  return NextResponse.json({
    code: group.code,
    group_order_id: group.id,
    status: group.status,
    is_host: group.host_customer_id === myId,
    vendor: { id: group.vendor_id, name: v?.name ?? 'Vendor' },
    items: itemRows,
    menu: (menu ?? []).map((m) => {
      const row = m as unknown as { id: string; name: string; price_kobo: number; category: string }
      return { id: row.id, name: row.name, price_kobo: row.price_kobo, category: row.category }
    }),
  })
}
