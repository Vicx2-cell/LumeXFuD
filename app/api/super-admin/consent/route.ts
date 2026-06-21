import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getConsentForOrder } from '@/lib/consent'

// GET /api/super-admin/consent?order=<order_number|order_id>
// Read-only dispute record (Invariant I8): every binding consent recorded for an
// order, oldest first. Super-admin only. The consent log is append-only at the DB
// level (migration 056 trigger), so this is a faithful, immutable history.
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('order') ?? '').trim()
  if (!q) return NextResponse.json({ error: 'Provide an order number or id.' }, { status: 400 })

  const db = createSupabaseAdmin()
  // Accept either the human order number (LXF-…) or the raw UUID id. Query by
  // number first; only try the id column when q looks like a UUID (querying a
  // uuid column with a non-uuid string errors).
  const cols = 'id, order_number, status, delivery_type'
  type OrderRow = { id: string; order_number: string; status: string; delivery_type: string }
  let order: OrderRow | null = null
  const { data: byNum } = await db.from('orders').select(cols).eq('order_number', q).maybeSingle()
  if (byNum) order = byNum as OrderRow
  else if (/^[0-9a-fA-F-]{36}$/.test(q)) {
    const { data: byId } = await db.from('orders').select(cols).eq('id', q).maybeSingle()
    if (byId) order = byId as OrderRow
  }

  const orderId = order?.id ?? q
  const consents = await getConsentForOrder(orderId)
  return NextResponse.json({
    order,
    order_number: order?.order_number ?? q,
    consents,
  })
}
