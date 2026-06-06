import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/money'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { VendorCardSkeleton } from '@/components/ui/skeleton'
import { HomepageClient } from '../homepage-client'
import { Suspense } from 'react'

export const revalidate = 30

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
      .in('status', ['OPEN', 'BUSY'])
      .order('composite_score', { referencedTable: 'vendor_scores', ascending: false })

    const { data: trending } = await db
      .from('trending_data')
      .select('orders_last_hour, top_item_name, top_item_count, top_vendor_name, new_vendor_name')
      .eq('id', 1)
      .single()

    return { vendors: vendors ?? [], trending }
  } catch {
    return { vendors: [], trending: null }
  }
}

export default async function CustomerHomePage() {
  const { vendors, trending } = await getVendorsAndTrending()

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
            <div>
              <span className="text-xs text-white/40">LumeX Fud</span>
              <h1 className="text-base font-semibold leading-tight">What are you eating today?</h1>
            </div>
          </div>
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

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
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

        <Suspense fallback={<SkeletonGrid />}>
          <HomepageClient initialVendors={vendors as VendorData[]} />
        </Suspense>
      </div>

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
}

export { formatPrice }
