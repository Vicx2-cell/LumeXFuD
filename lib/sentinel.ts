import { Redis } from '@upstash/redis'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import routeManifest from '@/lib/route-manifest.json'

// The Sentinel — a READ-ONLY health snapshot of the whole platform, shared by
// the super-admin dashboard (live view) and the 24/7 cron (alerts). It only
// observes; it never writes business data. Severity-coded issues drive both the
// dashboard's status light and the cron's alerts.

export type Severity = 'SEV1' | 'SEV2' | 'SEV3'
export interface SentinelIssue { severity: Severity; code: string; message: string }

export interface SentinelMetrics {
  orders_today: number
  paid_orders_today: number
  gmv_today_kobo: number
  orders_last_90m: number
  riders_online: number
  active_disputes: number
  wallet_float_kobo: number
  withdrawals_frozen: boolean
  ordering_enabled: boolean
  is_peak: boolean
}

export interface RouteHealth {
  total: number        // every API route in the codebase (from the manifest)
  probed: number       // static GET routes we could actually hit
  healthy: number
  broken: Array<{ path: string; status: number | string }>
  checked_at: string
}

export interface SentinelSnapshot {
  generated_at: string
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN'
  db_ok: boolean
  metrics: SentinelMetrics
  routes: RouteHealth | null
  issues: SentinelIssue[]
}

type DB = ReturnType<typeof createSupabaseAdmin>

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

interface ManifestRoute { path: string; dynamic: boolean; methods: string[] }

// Sweep every static GET route in the codebase and flag any that 5xx or time out.
// This is what makes the Sentinel watch the WHOLE surface, not just metrics — the
// manifest lists every route in the codebase (refresh it with `npm run gen:routes`
// after adding routes; scripts/ is .vercelignore'd so it can't run at build). Cached 120s
// in Redis so the dashboard's 60s refresh and the 5-min cron share one sweep.
async function probeRoutesUncached(base: string): Promise<RouteHealth> {
  const all = (routeManifest as { routes: ManifestRoute[] }).routes
  const candidates = all.filter((r) => !r.dynamic && r.methods.includes('GET'))
  const broken: Array<{ path: string; status: number | string }> = []
  let healthy = 0
  const queue = [...candidates]
  const root = base.replace(/\/$/, '')

  async function worker() {
    while (queue.length) {
      const r = queue.shift()!
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 4000)
      try {
        // GET only; auth'd routes answer 401/403 (alive). A 5xx or timeout = broken.
        const res = await fetch(root + r.path, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'x-sentinel-probe': '1' } })
        if (res.status >= 500) broken.push({ path: r.path, status: res.status })
        else healthy++
      } catch (e) {
        broken.push({ path: r.path, status: (e as Error)?.name === 'AbortError' ? 'timeout' : 'error' })
      } finally {
        clearTimeout(timer)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, () => worker()))
  return { total: all.length, probed: candidates.length, healthy, broken, checked_at: new Date().toISOString() }
}

export async function probeRoutes(): Promise<RouteHealth | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) return null
  const r = redis()
  if (r) {
    const cached = await r.get<RouteHealth>('sentinel:routes')
    if (cached) return cached
  }
  const result = await probeRoutesUncached(base)
  if (r) await r.set('sentinel:routes', result, { ex: 120 })
  return result
}

// Start of "today" in WAT (UTC+1, no DST) as a UTC ISO instant.
function todayStartWAT(): string {
  const wat = new Date(Date.now() + 60 * 60_000)
  const startUtcMs = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()) - 60 * 60_000
  return new Date(startUtcMs).toISOString()
}

// Campus peak windows in WAT: lunch 11:30–14:00, dinner 18:00–21:00.
export function isPeakNow(now: Date = new Date()): boolean {
  const wat = new Date(now.getTime() + 60 * 60_000)
  const h = wat.getUTCHours(), m = wat.getUTCMinutes()
  const lunch = (h === 11 && m >= 30) || h === 12 || h === 13
  const dinner = h >= 18 && h < 21
  return lunch || dinner
}

export async function gatherSnapshot(db: DB): Promise<SentinelSnapshot> {
  const issues: SentinelIssue[] = []
  let dbOk = true

  const todayIso = todayStartWAT()
  const since90m = new Date(Date.now() - 90 * 60_000).toISOString()
  const peak = isPeakNow()

  let ordersToday: Array<{ payment_status: string; total_amount: number; status: string }> = []
  let ridersOnline = 0
  let activeDisputes = 0
  let walletFloat = 0
  let ordersLast90m = 0
  let withdrawalsFrozen = false
  let orderingEnabled = true

  try {
    const [ordersRes, ridersRes, disputesRes, walletRes, last90Res, frozenRes] = await Promise.all([
      db.from('orders').select('payment_status, total_amount, status').gte('created_at', todayIso),
      db.from('riders').select('id', { count: 'exact', head: true }).in('status', ['ONLINE', 'BUSY']).eq('is_active', true),
      db.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'DISPUTED'),
      db.from('wallet_balances').select('held_balance'),
      db.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', since90m),
      db.from('settings').select('value').eq('id', 'withdrawals_frozen').maybeSingle(),
    ])
    if (ordersRes.error || ridersRes.error || walletRes.error) throw ordersRes.error ?? ridersRes.error ?? walletRes.error
    ordersToday = (ordersRes.data ?? []) as typeof ordersToday
    ridersOnline = ridersRes.count ?? 0
    activeDisputes = disputesRes.count ?? 0
    walletFloat = (walletRes.data ?? []).reduce((s, w) => s + Number((w as { held_balance: number }).held_balance ?? 0), 0)
    ordersLast90m = last90Res.count ?? 0
    const fv = (frozenRes.data as { value?: unknown } | null)?.value
    withdrawalsFrozen = fv === true || (typeof fv === 'object' && fv !== null && (fv as { value?: boolean }).value === true)
  } catch (err) {
    console.error('[sentinel] snapshot query failed:', err)
    dbOk = false
    issues.push({ severity: 'SEV1', code: 'DB_UNREACHABLE', message: 'Database query failed — the app may be down or Supabase is unreachable.' })
  }

  try {
    orderingEnabled = await getFeature('ordering')
  } catch {
    // feature read failure is non-fatal; assume enabled
  }

  const paidToday = ordersToday.filter((o) => o.payment_status === 'PAID')
  const gmv = paidToday.reduce((s, o) => s + Number(o.total_amount ?? 0), 0)

  // ── Derive issues ──────────────────────────────────────────────────────────
  if (withdrawalsFrozen) {
    issues.push({ severity: 'SEV1', code: 'WITHDRAWALS_FROZEN', message: 'Withdrawals are FROZEN — a wallet reconciliation shortfall was detected. Money owed to users may not be covered. Investigate now.' })
  }
  if (!orderingEnabled) {
    issues.push({ severity: 'SEV2', code: 'ORDERING_OFF', message: 'Ordering is turned OFF platform-wide. No one can place an order.' })
  }
  if (dbOk && peak && ordersLast90m === 0) {
    issues.push({ severity: 'SEV2', code: 'NO_ORDERS_PEAK', message: 'No orders in the last 90 minutes during a peak window — possible checkout/payment outage.' })
  }
  if (activeDisputes >= 3) {
    issues.push({ severity: 'SEV2', code: 'DISPUTES_PILEUP', message: `${activeDisputes} disputes open and unresolved.` })
  } else if (activeDisputes > 0) {
    issues.push({ severity: 'SEV3', code: 'DISPUTES_OPEN', message: `${activeDisputes} dispute${activeDisputes === 1 ? '' : 's'} waiting for resolution.` })
  }
  if (dbOk && peak && ridersOnline === 0) {
    issues.push({ severity: 'SEV3', code: 'NO_RIDERS_PEAK', message: 'No riders online during a peak window — deliveries may stall.' })
  }

  // Whole-surface sweep: probe every static GET route; any 5xx/timeout is a real
  // server fault somewhere in the code.
  let routes: RouteHealth | null = null
  try {
    routes = await probeRoutes()
  } catch (err) {
    console.error('[sentinel] route probe failed:', err)
  }
  if (routes && routes.broken.length > 0) {
    const list = routes.broken.slice(0, 6).map((b) => `${b.path} (${b.status})`).join(', ')
    issues.push({ severity: 'SEV1', code: 'ENDPOINTS_ERRORING', message: `${routes.broken.length} API endpoint${routes.broken.length === 1 ? '' : 's'} erroring: ${list}${routes.broken.length > 6 ? ' …' : ''}` })
  }

  const hasSev1 = issues.some((i) => i.severity === 'SEV1')
  const hasSev2 = issues.some((i) => i.severity === 'SEV2')
  const status: SentinelSnapshot['status'] = hasSev1 ? 'DOWN' : hasSev2 ? 'DEGRADED' : 'HEALTHY'

  return {
    generated_at: new Date().toISOString(),
    status,
    db_ok: dbOk,
    metrics: {
      orders_today: ordersToday.length,
      paid_orders_today: paidToday.length,
      gmv_today_kobo: gmv,
      orders_last_90m: ordersLast90m,
      riders_online: ridersOnline,
      active_disputes: activeDisputes,
      wallet_float_kobo: walletFloat,
      withdrawals_frozen: withdrawalsFrozen,
      ordering_enabled: orderingEnabled,
      is_peak: peak,
    },
    routes,
    issues,
  }
}
