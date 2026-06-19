import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/group-order/mine — the caller's OPEN, unexpired group orders (as host
// OR contributor), so they can always get back to a group they're in even after
// leaving the site. Returns only what a banner needs.
export async function GET() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return NextResponse.json({ groups: [] })
  if (!(await getFeature('group_orders'))) return NextResponse.json({ groups: [] })

  const db = createSupabaseAdmin()
  const { data: meRow } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  const myId = (meRow as { id: string } | null)?.id
  if (!myId) return NextResponse.json({ groups: [] })

  const nowIso = new Date().toISOString()

  // Groups I host, plus groups I've added an item to.
  const { data: contribRows } = await db.from('group_order_items').select('group_order_id').eq('contributor_id', myId)
  const contribIds = Array.from(new Set((contribRows ?? []).map((r) => (r as { group_order_id: string }).group_order_id)))

  const { data: hosted } = await db
    .from('group_orders')
    .select('id, code, vendor_id, host_customer_id, expires_at')
    .eq('status', 'OPEN').gt('expires_at', nowIso).eq('host_customer_id', myId)

  let joined: typeof hosted = []
  if (contribIds.length > 0) {
    const { data } = await db
      .from('group_orders')
      .select('id, code, vendor_id, host_customer_id, expires_at')
      .eq('status', 'OPEN').gt('expires_at', nowIso).in('id', contribIds)
    joined = data ?? []
  }

  const byId = new Map<string, { id: string; code: string; vendor_id: string; host_customer_id: string; expires_at: string }>()
  for (const g of [...(hosted ?? []), ...(joined ?? [])]) byId.set((g as { id: string }).id, g as never)
  const groups = Array.from(byId.values())
  if (groups.length === 0) return NextResponse.json({ groups: [] })

  const vendorIds = Array.from(new Set(groups.map((g) => g.vendor_id)))
  const { data: vendors } = await db.from('vendors').select('id, name').in('id', vendorIds)
  const vendorName = new Map((vendors ?? []).map((v) => [(v as { id: string }).id, (v as { name: string | null }).name ?? 'Vendor']))

  return NextResponse.json({
    groups: groups.map((g) => ({
      code: g.code,
      vendor_name: vendorName.get(g.vendor_id) ?? 'Vendor',
      is_host: g.host_customer_id === myId,
      expires_at: g.expires_at,
    })),
  })
}
