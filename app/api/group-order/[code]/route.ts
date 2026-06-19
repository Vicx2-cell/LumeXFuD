import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/group-order/[code] — the shared group view: vendor, the running item
// list (who added what, with live menu prices), the available menu for adding
// more, and whether the caller is the host. Logged-in customers only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The 6-char code is the access key — cap lookups so it can't be brute-forced.
  const rl = await rateLimitGeneric(`group-view:${session.userId ?? session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  const { code } = await params
  const db = createSupabaseAdmin()

  const { data: g } = await db
    .from('group_orders')
    .select('id, code, vendor_id, host_customer_id, status, expires_at')
    .eq('code', code.toUpperCase())
    .maybeSingle()
  const group = g as { id: string; code: string; vendor_id: string; host_customer_id: string; status: string; expires_at: string } | null
  if (!group) return NextResponse.json({ error: 'Group order not found' }, { status: 404 })
  if (group.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This group order was cancelled by the host.', cancelled: true }, { status: 410 })
  }
  if (group.status === 'EXPIRED' || new Date(group.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This group order has expired.', expired: true }, { status: 410 })
  }

  // Did the host turn bill-splitting on? Best-effort (column may not exist pre-067).
  let splitEnabled = true
  try {
    const { data: s } = await db.from('group_orders').select('split_enabled').eq('id', group.id).maybeSingle()
    const v = (s as { split_enabled?: boolean } | null)?.split_enabled
    if (typeof v === 'boolean') splitEnabled = v
  } catch { /* default split on */ }

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

  // Wallet coverage: can each member's wallet cover their FOOD so far? (Fees are
  // added at checkout; this is the readiness indicator + top-up prompt driver.)
  const foodByPerson = new Map<string, number>()
  for (const r of itemRows) foodByPerson.set(r.contributor_id, (foodByPerson.get(r.contributor_id) ?? 0) + r.price_kobo * r.quantity)
  const contribIds = Array.from(foodByPerson.keys())
  const funded: Record<string, boolean> = {}
  let myBalanceKobo = 0
  try {
    const lookupIds = Array.from(new Set([...contribIds, myId])).filter(Boolean)
    if (lookupIds.length) {
      const { data: wallets } = await db.from('customer_wallets').select('customer_id, balance_kobo, is_frozen').in('customer_id', lookupIds)
      const balMap = new Map((wallets ?? []).map((w) => {
        const row = w as { customer_id: string; balance_kobo: number; is_frozen: boolean }
        return [row.customer_id, row.is_frozen ? 0 : Number(row.balance_kobo)]
      }))
      for (const id of contribIds) funded[id] = (balMap.get(id) ?? 0) >= (foodByPerson.get(id) ?? 0)
      myBalanceKobo = balMap.get(myId) ?? 0
    }
  } catch { /* coverage is best-effort */ }

  return NextResponse.json({
    code: group.code,
    group_order_id: group.id,
    status: group.status,
    expires_at: group.expires_at,
    is_host: group.host_customer_id === myId,
    host_id: group.host_customer_id,
    split_enabled: splitEnabled,
    funded,
    my_balance_kobo: myBalanceKobo,
    my_food_kobo: foodByPerson.get(myId) ?? 0,
    vendor: { id: group.vendor_id, name: v?.name ?? 'Vendor' },
    items: itemRows,
    menu: (menu ?? []).map((m) => {
      const row = m as unknown as { id: string; name: string; price_kobo: number; category: string }
      return { id: row.id, name: row.name, price_kobo: row.price_kobo, category: row.category }
    }),
  })
}

// PATCH /api/group-order/[code] — host toggles bill-splitting on/off.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { code } = await params
  const body = await req.json().catch(() => null)
  const split = (body as { split_enabled?: unknown } | null)?.split_enabled
  if (typeof split !== 'boolean') return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: gRow } = await db.from('group_orders').select('id, host_customer_id, status').eq('code', code.toUpperCase()).maybeSingle()
  const g = gRow as { id: string; host_customer_id: string; status: string } | null
  if (!g) return NextResponse.json({ error: 'Group order not found' }, { status: 404 })
  if (g.status !== 'OPEN') return NextResponse.json({ error: 'This group order is closed.' }, { status: 409 })

  const { data: meRow } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  if ((meRow as { id: string } | null)?.id !== g.host_customer_id) {
    return NextResponse.json({ error: 'Only the host can change this.' }, { status: 403 })
  }

  const { error } = await db.from('group_orders').update({ split_enabled: split }).eq('id', g.id)
  if (error) return NextResponse.json({ error: 'Could not update.' }, { status: 500 })
  return NextResponse.json({ success: true, split_enabled: split })
}
