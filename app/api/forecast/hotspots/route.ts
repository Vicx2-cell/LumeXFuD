import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { forecastHotspots, type Hotspot } from '@/lib/demand'

// Rider "position near here" board: which OPEN vendors look hot in the next
// hour. Deterministic (no AI). Cached briefly because it scans recent orders
// across all vendors and riders poll often.
export const dynamic = 'force-dynamic'

type Slim = { shopName: string; level: Hotspot['level']; expectedNextHour: number }

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session || (session.role !== 'rider' && session.role !== 'admin' && session.role !== 'super_admin')) {
    return NextResponse.json({ enabled: false, hotspots: [] })
  }
  if (!(await getFeature('demand_forecast'))) return NextResponse.json({ enabled: false, hotspots: [] })

  const r = redis()
  const key = `forecast:hotspots:${Math.floor(Date.now() / (5 * 60_000))}` // 5-min slot
  if (r) {
    const cached = await r.get<Slim[]>(key)
    if (cached) return NextResponse.json({ enabled: true, hotspots: cached })
  }

  const db = createSupabaseAdmin()
  const hot = await forecastHotspots(db, 3)
  const slim: Slim[] = hot.map((h) => ({ shopName: h.shopName, level: h.level, expectedNextHour: h.expectedNextHour }))

  if (r) await r.set(key, slim, { ex: 300 })
  return NextResponse.json({ enabled: true, hotspots: slim })
}
