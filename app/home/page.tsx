import crypto from 'node:crypto'
import dynamicImport from 'next/dynamic'
import { Suspense } from 'react'
import { UserRound, WalletCards } from 'lucide-react'
import { BottomNav } from '@/components/nav-bottom'
import { BrandLogo } from '@/components/brand-logo'
import { getFeature } from '@/lib/features'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'
import { VendorCardSkeleton } from '@/components/ui/skeleton'
import { HomepageClient } from '../homepage-client'
import { SmoothScroll } from '@/components/fx'
import { mapVendorSignals, rankVendorFeed } from '@/lib/vendor-feed-fairness'

type HomeLocationRow = {
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  zone_id: string
  zone_name: string
  uses_lodge_catalog: boolean
}

// Always render fresh - vendor open/closed status and the ranked list must never
// be served stale from a cached page. (Realtime keeps it live after first paint.)
export const dynamic = 'force-dynamic'

const LumiChat = dynamicImport(() => import('@/components/LumiChat'))
const NotificationBell = dynamicImport(
  () => import('@/components/notification-bell').then((mod) => mod.NotificationBell),
  {
    loading: () => (
      <div className="w-11 h-11 rounded-full bg-white/10" aria-hidden="true" />
    ),
  },
)

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

async function getPreferredZoneId(session: Awaited<ReturnType<typeof getCurrentUser>>): Promise<string | null> {
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
        id, slug, shop_name, logo_url, shop_photo_url, prep_time_minutes,
        status, paused_until, category, avg_rating, total_ratings, is_active,
        city_id, zone_id,
        vendor_scores ( composite_score, visibility_tier )
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(notCurrentlySuspendedOr())
      .order('composite_score', { referencedTable: 'vendor_scores', ascending: false })

    if (zoneId) query = query.eq('zone_id', zoneId)

    const { data: vendors } = await query
    const vendorRows = (vendors ?? []) as VendorData[]

    const vendorIds = vendorRows.map((vendor) => vendor.id)
    let signals = new Map<string, { impressions?: number; clicks?: number; views?: number; downloads?: number; shares?: number; orders?: number }>()
    if (vendorIds.length > 0) {
      const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const { data: eventRows } = await db
        .from('campaign_events')
        .select('vendor_id, event_type')
        .in('vendor_id', vendorIds)
        .gte('created_at', cutoff)
      signals = mapVendorSignals((eventRows ?? []).map((row) => ({
        vendor_id: row.vendor_id as string,
        event_type: row.event_type as string,
        count: 1,
      })))
    }

    const { data: trending } = await db
      .from('trending_data')
      .select('orders_last_hour, top_item_name, top_item_count, top_vendor_name, new_vendor_name')
      .eq('id', 1)
      .single()

    let verifiedIds = new Set<string>()
    try {
      const { data: marks } = await db.storage.from('kyc-faces').list('complete', { limit: 1000 })
      verifiedIds = new Set((marks ?? []).map((m) => m.name))
    } catch {
      // Bucket or marker missing - just skip the badge.
    }

    const withVerified = vendorRows.map((v) => ({ ...v, kyc_verified: verifiedIds.has(v.id as string) }))
    const ranked = rankVendorFeed(withVerified, signals)

    return { vendors: ranked, trending }
  } catch {
    return { vendors: [], trending: null }
  }
}

export default async function CustomerHomePage() {
  const marketplaceCampaignId = crypto.randomUUID()
  const [locations, , walletOn, session] = await Promise.all([
    getLocations(),
    getFeature('study'),
    getFeature('customer_wallet_enabled'),
    getCurrentUser(),
  ])
  const preferredZoneId = await getPreferredZoneId(session)
  const [{ vendors }] = await Promise.all([
    getVendorsAndTrending(preferredZoneId ?? locations[0]?.zone_id ?? null),
  ])

  let favorites: string[] = []
  let firstName = ''
  try {
    if (session?.userId && session.role === 'customer') {
      const db = createSupabaseAdmin()
      const [{ data: favs }, { data: me }] = await Promise.all([
        db.from('customer_favorites').select('vendor_id').eq('customer_id', session.userId),
        db.from('customers').select('name').eq('id', session.userId).maybeSingle(),
      ])
      favorites = (favs ?? []).map((r) => r.vendor_id as string)
      firstName = ((me?.name as string | null) ?? '').trim().split(' ')[0] ?? ''
    }
  } catch {
    // Non-critical - never block the home render.
  }

  const lagosHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()))
  const partOfDay = lagosHour < 12 ? 'morning' : lagosHour < 17 ? 'afternoon' : 'evening'
  const greeting = `Good ${partOfDay}${firstName ? `, ${firstName}` : ''}`

  return (
    <main className="lx-page pb-24">
      <SmoothScroll />
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size={34} rounded={10} />
            <div className="min-w-0">
              <span className="text-xs text-[var(--lx-text-muted)]">{greeting}</span>
              <p className="truncate text-sm font-semibold leading-tight text-[var(--lx-text)]">LumeX Fud</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {walletOn && session?.role === 'customer' && (
              <a
                href="/profile/wallet"
                className="lx-card-amber-strong flex h-11 w-11 items-center justify-center rounded-full"
                aria-label="Wallet"
              >
                <WalletCards size={18} className="lx-amber" aria-hidden="true" />
              </a>
            )}
            {session?.role === 'customer' ? (
              <>
                <NotificationBell />
                <a
                  href="/profile"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--lx-border)] bg-[var(--lx-surface)] text-[var(--lx-text-muted)] hover:text-[var(--lx-text)]"
                  aria-label="Profile"
                >
                  <UserRound size={18} aria-hidden="true" />
                </a>
              </>
            ) : (
              <a href="/auth" className="lx-btn-secondary px-4 py-2 text-sm" style={{ minHeight: 44 }}>
                Sign in
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 max-w-2xl">
        <p className="lx-mono mb-2 text-[var(--color-amber)]">Restaurants near you</p>
        <h1 className="text-2xl font-bold leading-tight text-[var(--lx-text)] sm:text-3xl">What are you eating today?</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--lx-text-muted)]">Browse what&apos;s open, compare prep times, and order from trusted campus kitchens.</p>
      </div>
      <Suspense fallback={<SkeletonGrid />}>
        <HomepageClient
          initialVendors={vendors as VendorData[]}
          initialFavorites={favorites}
          initialLocations={locations as HomeLocationRow[]}
          initialSelectedZoneId={preferredZoneId ?? locations[0]?.zone_id ?? ''}
          campaignId={marketplaceCampaignId}
          canManageFavorites={session?.role === 'customer'}
        />
      </Suspense>
      </div>
      <LumiChat />
      <BottomNav />
    </main>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {[1, 2, 3].map((i) => <VendorCardSkeleton key={i} />)}
    </div>
  )
}

export interface VendorData {
  id: string
  slug: string | null
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
