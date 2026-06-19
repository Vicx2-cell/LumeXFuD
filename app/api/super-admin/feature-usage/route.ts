import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Friendly names for the tracked feature keys (lib/usage trackFeature calls).
const LABELS: Record<string, string> = {
  ordering: 'Place order',
  group_orders: 'Group ordering',
  sponsor_topup: 'Parent top-up',
  wallet_topup: 'Wallet top-up',
  chow_ai: 'Lumi (food AI)',
  vendor_ai: 'Vendor AI',
  rider_ai: 'Rider AI',
  reviews: 'Reviews',
}

interface Agg { key: string; label: string; total: number; roles: Record<string, number>; last_used: string | null }

// GET /api/super-admin/feature-usage — super-admin only. Most-used features with
// a per-role (customer/vendor/rider/guest) breakdown. Read-only.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data } = await db.from('feature_usage').select('feature_key, role, count, last_used')

  const map = new Map<string, Agg>()
  for (const r of (data ?? []) as Array<{ feature_key: string; role: string; count: number; last_used: string | null }>) {
    const e = map.get(r.feature_key) ?? { key: r.feature_key, label: LABELS[r.feature_key] ?? r.feature_key, total: 0, roles: {}, last_used: null }
    const n = Number(r.count) || 0
    e.total += n
    e.roles[r.role] = (e.roles[r.role] ?? 0) + n
    if (r.last_used && (!e.last_used || r.last_used > e.last_used)) e.last_used = r.last_used
    map.set(r.feature_key, e)
  }

  const features = Array.from(map.values()).sort((a, b) => b.total - a.total)
  return NextResponse.json({
    features,
    total_events: features.reduce((s, f) => s + f.total, 0),
  })
}
