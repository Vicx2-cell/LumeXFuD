import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'
import { getCurrentUser } from '@/lib/session'
import { formatPrice } from '@/lib/money'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { BrandLogo } from '@/components/brand-logo'
import { Lumi } from '@/components/chow-ai'
import { NotificationBell } from '@/components/notification-bell'
import { StreakNudge } from '@/components/streak-nudge'
import { LaunchCounter } from '@/components/launch-counter'
import ActiveGroupBanner from '@/components/active-group-banner'
import { getFeature } from '@/lib/features'
import { VendorCardSkeleton } from '@/components/ui/skeleton'
import { HomepageClient } from '../homepage-client'
import { CountUp, SmoothScroll } from '@/components/fx'
import { Suspense } from 'react'

type HomeLocationRow = {
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  zone_id: string
  zone_name: string
  uses_lodge_catalog: boolean
}

// Always render fresh — vendor open/closed status and the ranked list must never
// be served stale from a cached page. (Realtime keeps it live after first paint.)
export const dynamic = 'force-dynamic'

async function getLocations() {
  const db = createSupabaseAdmin()
  const { data: cities } = await db
    .from('cities')
    .select('id, name, state, slug, status')
    .eq('status', 'ACTIVE')
    .order('state', { ascending: true })
    .order('name', { ascending: true })

  const cityRows = (cities ?? []) as Array<{ id: string; name: string; state: string; slug: string }>
  if (cityRows.length === 0) return []

  const cityIds = cityRows.map((city) => city.id)
  const { data: zones } = await db
    .from('delivery_zones')
    .select('id, city_id, name, status, uses_lodge_catalog')
    .eq('status', 'ACTIVE')
    .in('city_id', cityIds)
    .order('created_at', { ascending: true })

  const cityById = new Map(cityRows.map((city) => [city.id, city]))
  return ((zones ?? []) as Array<{ id: string; city_id: string; name: string; uses_lodge_catalog?: boolean | null }>).flatMap((zone) => {
    const city = cityById.get(zone.city_id)
    if (!city) return []
    return [{
      city_id: city.id,
      city_name: city.name,
      city_state: city.state,
      city_slug: city.slug,
      zone_id: zone.id,
      zone_name: zone.name,
      uses_lodge_catalog: zone.uses_lodge_catalog ?? (city.slug === 'uturu'),
    }]
  })
}

async function getPreferredZoneId(): Promise<string | null> {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return null
  const db = createSupabaseAdmin()
  let customerId = session.userId ?? null
  if (!customerId) {
    const { data } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
    customerId = (data as { id: string } | null)?.id ?? null
  }
  if (!customerId) return null
  const { data } = await db
    .from('customer_locations')
    .select('zone_id')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  return (data as { zone_id?: string | null } | null)?.zone_id ?? null
}

async function getVendorsAndTrending(zoneId?: string | null) {
  try {
    const db = createSupabaseAdmin()
    let query = db
      .from('vendors')
      .select(`
        id, shop_name, logo_url, shop_photo_url, prep_time_minutes,
        status, paused_until, category, avg_rating, total_ratings, is_active,
        city_id, zone_id,
        vendor_scores ( composite_score, visibility_tier )
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(notCurrentlySuspendedOr()) // a suspended vendor must drop off the home list
      // NOTE: no status filter — vendors NEVER disappear from home, even when
      // CLOSED or paused. The client sorts the unavailable ones to the bottom
      // and marks them clearly so customers don't waste time tapping them.
      .order('composite_score', { referencedTable: 'vendor_scores', ascending: false })

    if (zoneId) query = query.eq('zone_id', zoneId)

    const { data: vendors } = await query

    const { data: trending } = await db
      .from('trending_data')
      .select('orders_last_hour, top_item_name, top_item_count, top_vendor_name, new_vendor_name')
      .eq('id', 1)
      .single()

    // One cheap storage call: which vendors are fully KYC-verified (marker file).
    let verifiedIds = new Set<string>()
    try {
      const { data: marks } = await db.storage.from('kyc-faces').list('complete', { limit: 1000 })
      verifiedIds = new Set((marks ?? []).map((m) => m.name))
    } catch { /* bucket/marker missing — just no badges */ }
    const withVerified = (vendors ?? []).map((v) => ({ ...v, kyc_verified: verifiedIds.has(v.id as string) }))

    return { vendors: withVerified, trending }
  } catch {
    return { vendors: [], trending: null }
  }
}

export default async function CustomerHomePage() {
  const [locations, studyOn, walletOn] = await Promise.all([
    getLocations(),
    getFeature('study'),
    getFeature('customer_wallet_enabled'),
  ])
  const preferredZoneId = await getPreferredZoneId()
  const [{ vendors, trending }] = await Promise.all([
    getVendorsAndTrending(preferredZoneId ?? locations[0]?.zone_id ?? null),
  ])

  // The signed-in customer's favourite vendor ids — powers the heart state + the
  // one-tap "Favourites" filter on the list. Empty for guests/other roles.
  let favorites: string[] = []
  let firstName = ''
  try {
    const session = await getCurrentUser()
    if (session?.userId && session.role === 'customer') {
      const db = createSupabaseAdmin()
      const [{ data: favs }, { data: me }] = await Promise.all([
        db.from('customer_favorites').select('vendor_id').eq('customer_id', session.userId),
        db.from('customers').select('name').eq('id', session.userId).maybeSingle(),
      ])
      favorites = (favs ?? []).map((r) => r.vendor_id as string)
      firstName = ((me?.name as string | null) ?? '').trim().split(' ')[0] ?? ''
    }
  } catch { /* non-critical — never block the home render */ }

  // Time-of-day greeting in campus (Lagos) time — a warm, personal header beats a
  // static line. force-dynamic, so server time is correct per request.
  const lagosHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()))
  const partOfDay = lagosHour < 12 ? 'morning' : lagosHour < 17 ? 'afternoon' : 'evening'
  const greeting = `Good ${partOfDay}${firstName ? `, ${firstName}` : ''}`

  return (
    <main className="lx-page pb-24">
      {/* Smooth scroll on the dashboard — native touch (no synced-touch) so fast
          flicks to a vendor stay instant and the keyboard/nested scrollers behave. */}
      <SmoothScroll />
      {/* Header */}
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BackButton />
            <BrandLogo size={34} rounded={10} />
            <div className="min-w-0">
              <span className="text-xs text-white/40">{greeting} 👋</span>
              <h1 className="text-sm sm:text-base font-semibold leading-tight lx-foodie-text truncate">What are you eating today?</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {walletOn && (
            <a
              href="/profile/wallet"
              className="lx-card-amber-strong h-11 px-3 rounded-full flex items-center gap-1.5"
              aria-label="Wallet"
            >
              <span className="text-sm" aria-hidden="true">💰</span>
              <span className="lx-amber text-xs font-semibold">Wallet</span>
            </a>
            )}
            <NotificationBell />
            <a
              href="/profile"
              className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center"
              aria-label="Profile"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5 lx-stagger">
        {/* Active group orders — always shows the way back into a group you're in */}
        <ActiveGroupBanner />

        {/* Streak nudge — loss-aversion hook for returning customers */}
        <StreakNudge />

        {/* Launch counter — self-hides unless the super-admin flag is on */}
        <LaunchCounter />

        {/* Study entry — the course tool (separate product). Gated by the `study` flag. */}
        {studyOn && (
          <a
            href="/study"
            className="block rounded-2xl p-4"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl shrink-0" aria-hidden="true">📚</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">
                  Study <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full align-middle" style={{ background: 'rgba(99,102,241,0.25)', color: '#c7d2fe' }}>beta</span>
                </p>
                <p className="text-xs text-white/55 mt-0.5">Pick your department to see your courses &amp; practice.</p>
              </div>
              <svg className="shrink-0 opacity-50" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </a>
        )}

        {/* Trending */}
        {trending && trending.orders_last_hour && (
          <div className="lx-card-amber rounded-2xl p-4 flex items-center gap-3">
            <span className="text-2xl">🔥</span>
            <div>
              <p className="lx-amber text-sm font-semibold">
                <CountUp value={trending.orders_last_hour} /> orders in the last hour
              </p>
              {trending.top_item_name && (
                <p className="text-xs text-white/60 mt-0.5">
                  Top item: {trending.top_item_name}
                  {trending.top_item_count ? ` (${trending.top_item_count} orders)` : ''}
                </p>
              )}
            </div>
          </div>
        )}

        <div id="vendors" className="scroll-mt-20">
          <Suspense fallback={<SkeletonGrid />}>
            <HomepageClient
              initialVendors={vendors as VendorData[]}
              initialFavorites={favorites}
              initialLocations={locations as HomeLocationRow[]}
              initialSelectedZoneId={preferredZoneId ?? locations[0]?.zone_id ?? ''}
            />
          </Suspense>
        </div>
      </div>

      <Lumi />
      <BottomNav />
    </main>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4">
      {[1, 2, 3].map((i) => <VendorCardSkeleton key={i} />)}
    </div>
  )
}

export interface VendorData {
  id: string
  shop_name: string
  logo_url: string | null
  shop_photo_url: string | null
  prep_time_minutes: number
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  category: string
  avg_rating: number
  total_ratings: number
  vendor_scores: Array<{ composite_score: number; visibility_tier: string }> | null
  kyc_verified?: boolean
}

export { formatPrice }
