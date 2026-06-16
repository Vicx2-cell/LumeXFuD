import { createSupabaseAdmin } from './supabase/server'

// ─── Demand forecasting (deterministic) ──────────────────────────────────────
// Predicts the next ~60 min of order volume PER VENDOR so kitchens can pre-prep
// and riders can pre-position — the quiet lever behind the <25-min delivery
// target. The forecast is pure statistics (LLMs are bad at arithmetic); any AI
// is only used to *phrase* the advice, never to compute the number.
//
// Self-calibrating: every threshold is relative to the vendor's OWN history, so
// a quiet kitchen and a busy one each get a sensible "is this hour unusual?"
// read without any hand-tuned per-vendor config. Lagos is a fixed UTC+1 (no
// DST), so local hour/day = UTC shifted by one hour — exact and cheap.

const HOUR_MS = 3_600_000
const WINDOW_DAYS = 28

export type DemandLevel = 'quiet' | 'normal' | 'high' | 'surge'

export interface VendorForecast {
  vendorId: string
  /** Rounded expected orders in the coming ~60 min. */
  expectedNextHour: number
  level: DemandLevel
  /** How much history backs this — drives whether the UI shows it at all. */
  confidence: 'low' | 'medium' | 'high'
  /** Orders actually placed in the last 60 min (the momentum signal). */
  recentLastHour: number
  /** Total orders seen in the window (sample size). */
  sampleSize: number
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/** Africa/Lagos wall-clock for a UTC instant (fixed +01:00, no DST). */
function lagos(ms: number): Date {
  return new Date(ms + HOUR_MS)
}

/**
 * Pure forecast from a vendor's order timestamps. Separated from the DB so it
 * can be unit-tested with synthetic data.
 */
export function computeForecast(vendorId: string, createdAtMs: number[], nowMs: number): VendorForecast {
  const windowStart = nowMs - WINDOW_DAYS * 24 * HOUR_MS
  const ts = createdAtMs.filter((t) => t >= windowStart && t <= nowMs)
  const sampleSize = ts.length

  // Seasonal shape: total orders per hour-of-day, averaged over active days.
  const hourTotals = new Array(24).fill(0)
  const activeDays = new Set<string>()
  const dayHourBuckets = new Set<string>()
  for (const t of ts) {
    const l = lagos(t)
    const hour = l.getUTCHours()
    const dayKey = l.toISOString().slice(0, 10)
    hourTotals[hour] += 1
    activeDays.add(dayKey)
    dayHourBuckets.add(`${dayKey}|${hour}`)
  }
  const nDays = Math.max(activeDays.size, 1)
  const seasonalHour = (h: number) => hourTotals[((h % 24) + 24) % 24] / nDays

  const curHour = lagos(nowMs).getUTCHours()

  // Momentum: how the last 60 min compares to this hour's seasonal norm.
  const recentLastHour = ts.filter((t) => t >= nowMs - HOUR_MS).length
  const momentum = clamp((recentLastHour + 0.7) / (seasonalHour(curHour) + 0.7), 0.5, 2.5)

  // The coming 60 min straddles the current + next clock hour → blend them.
  const seasonalTarget = (seasonalHour(curHour) + seasonalHour(curHour + 1)) / 2
  const expectedRaw = seasonalTarget * momentum

  // "Typical" = average orders per active hour for THIS vendor (self-calibration).
  const typical = sampleSize / Math.max(dayHourBuckets.size, 1)
  const ratio = expectedRaw / Math.max(typical, 0.5)

  let level: DemandLevel = 'normal'
  if (ratio >= 1.8) level = 'surge'
  else if (ratio >= 1.2) level = 'high'
  else if (ratio < 0.5) level = 'quiet'

  const confidence = sampleSize < 12 ? 'low' : sampleSize < 60 ? 'medium' : 'high'

  return {
    vendorId,
    expectedNextHour: Math.max(0, Math.round(expectedRaw)),
    level,
    confidence,
    recentLastHour,
    sampleSize,
  }
}

type DB = ReturnType<typeof createSupabaseAdmin>

/** Forecast a single vendor (their own dashboard "prep-ahead" banner). */
export async function forecastVendor(db: DB, vendorId: string): Promise<VendorForecast> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * HOUR_MS).toISOString()
  const { data } = await db
    .from('orders')
    .select('created_at')
    .eq('vendor_id', vendorId)
    .gte('created_at', since)
    .limit(5000)

  const ms = ((data ?? []) as Array<{ created_at: string }>).map((r) => new Date(r.created_at).getTime())
  return computeForecast(vendorId, ms, Date.now())
}

export interface Hotspot extends VendorForecast {
  shopName: string
}

/**
 * Rank currently-OPEN vendors by how hot the next hour looks — the rider
 * "position near here" board. Only returns vendors trending high/surge.
 */
export async function forecastHotspots(db: DB, limit = 3): Promise<Hotspot[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * HOUR_MS).toISOString()
  const { data } = await db
    .from('orders')
    .select('vendor_id, created_at')
    .gte('created_at', since)
    .limit(20000)

  const byVendor = new Map<string, number[]>()
  for (const r of (data ?? []) as Array<{ vendor_id: string; created_at: string }>) {
    const arr = byVendor.get(r.vendor_id) ?? []
    arr.push(new Date(r.created_at).getTime())
    byVendor.set(r.vendor_id, arr)
  }

  const { data: openVendors } = await db
    .from('vendors')
    .select('id, shop_name')
    .eq('status', 'OPEN')
    .eq('is_active', true)
    .is('deleted_at', null)

  const nameById = new Map<string, string>()
  for (const v of (openVendors ?? []) as Array<{ id: string; shop_name: string }>) nameById.set(v.id, v.shop_name)

  const now = Date.now()
  const hotspots: Hotspot[] = []
  for (const [vendorId, ms] of byVendor) {
    const name = nameById.get(vendorId)
    if (!name) continue // closed / inactive → riders can't pick these up anyway
    const f = computeForecast(vendorId, ms, now)
    if ((f.level === 'surge' || f.level === 'high') && f.expectedNextHour >= 1) {
      hotspots.push({ ...f, shopName: name })
    }
  }

  return hotspots
    .sort((a, b) => b.expectedNextHour - a.expectedNextHour)
    .slice(0, limit)
}
