import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/money'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { BrandLogo } from '@/components/brand-logo'
import { Lumi } from '@/components/chow-ai'
import { StreakNudge } from '@/components/streak-nudge'
import { LaunchCounter } from '@/components/launch-counter'
import { getFeature } from '@/lib/features'
import { VendorCardSkeleton } from '@/components/ui/skeleton'
import { HomepageClient } from '../homepage-client'
import { Suspense } from 'react'

// Always render fresh — vendor open/closed status and the ranked list must never
// be served stale from a cached page. (Realtime keeps it live after first paint.)
export const dynamic = 'force-dynamic'

async function getVendorsAndTrending() {
  try {
    const db = createSupabaseAdmin()

    const { data: vendors } = await db
      .from('vendors')
      .select(`
        id, shop_name, logo_url, shop_photo_url, prep_time_minutes,
        status, paused_until, category, avg_rating, total_ratings, is_active,
        vendor_scores ( composite_score, visibility_tier )
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      // NOTE: no status filter — vendors NEVER disappear from home, even when
      // CLOSED or paused. The client sorts the unavailable ones to the bottom
      // and marks them clearly so customers don't waste time tapping them.
      .order('composite_score', { referencedTable: 'vendor_scores', ascending: false })

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
  const [{ vendors, trending }, studyOn] = await Promise.all([
    getVendorsAndTrending(),
    getFeature('study'),
  ])

  return (
    <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 border-b border-white/8"
        style={{ background: 'rgba(10,10,11,0.9)', backdropFilter: 'blur(20px)' }}
      >
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BackButton />
            <BrandLogo size={34} rounded={10} />
            <div>
              <span className="text-xs text-white/40">LumeX Fud</span>
              <h1 className="text-base font-semibold leading-tight lx-foodie-text">What are you eating today?</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/profile/wallet"
              className="h-9 px-3 rounded-full flex items-center gap-1.5"
              style={{ background: 'rgba(245,166,35,0.14)', border: '1px solid rgba(245,166,35,0.3)' }}
              aria-label="Wallet"
            >
              <span className="text-sm">💰</span>
              <span className="text-xs font-semibold" style={{ color: '#F5A623' }}>Wallet</span>
            </a>
            <a
              href="/profile"
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center"
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

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
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
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.2)' }}
          >
            <span className="text-2xl">🔥</span>
            <div>
              <p className="text-sm font-semibold text-[#F5A623]">
                {trending.orders_last_hour} orders in the last hour
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
            <HomepageClient initialVendors={vendors as VendorData[]} />
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
