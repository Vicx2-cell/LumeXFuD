import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { BottomNav } from '@/components/nav-bottom'
import { vendorPath } from '@/lib/seo/config'
import { VendorMenuClient } from './vendor-menu-client'

// Always render fresh — a vendor's menu, prices and open/closed status must not
// be served stale from a cached page.
export const dynamic = 'force-dynamic'

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createSupabaseAdmin()

  const { data: vendor } = await db
    .from('vendors')
    .select(`
      id, slug, shop_name, owner_name, logo_url, shop_photo_url,
      prep_time_minutes, status, paused_until, category, description,
      avg_rating, total_ratings, is_active, opening_time, closing_time
    `)
    .eq('id', id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single()

  if (!vendor) notFound()

  // Fully KYC-verified? (one tiny marker check) — drives the customer Verified badge.
  let kyc_verified = false
  try {
    const { data: mk } = await db.storage.from('kyc-faces').createSignedUrl(`complete/${id}`, 60)
    kyc_verified = !!mk
  } catch { /* no marker — not verified */ }

  const { data: menu } = await db
    .from('menu_items')
    .select('id, name, description, price_kobo, image_url, category, is_available, prep_time_minutes, daily_limit, sold_today, display_order')
    .eq('vendor_id', id)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })

  const baseItems = (menu ?? []) as Omit<MenuItem, 'addons'>[]

  // Attach available add-ons per item. (Degrades gracefully to none if migration
  // 020 hasn't been run yet — the query just returns no rows.)
  const itemIds = baseItems.map((i) => i.id)
  const byItem = new Map<string, MenuAddon[]>()
  if (itemIds.length > 0) {
    const { data: addonRows } = await db
      .from('menu_item_addons')
      .select('id, menu_item_id, name, price_kobo')
      .in('menu_item_id', itemIds)
      .eq('is_available', true)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
    for (const a of (addonRows ?? []) as Array<MenuAddon & { menu_item_id: string }>) {
      const arr = byItem.get(a.menu_item_id) ?? []
      arr.push({ id: a.id, name: a.name, price_kobo: a.price_kobo })
      byItem.set(a.menu_item_id, arr)
    }
  }
  const menuWithAddons: MenuItem[] = baseItems.map((i) => ({ ...i, addons: byItem.get(i.id) ?? [] }))

  // Public reviews (most recent first). Degrades to none if migration 043 hasn't
  // run yet — the query just returns no rows. Reviewer identity is deliberately
  // NOT selected here: reviews show as "Anonymous" to the public. The account
  // behind a review is still recoverable server-side (ratings.customer_id +
  // the `vendor_rated` audit-log entry) so a super-admin can trace/flag abuse.
  const { data: reviewRows } = await db
    .from('ratings')
    .select('id, stars, review, created_at')
    .eq('vendor_id', id)
    .order('created_at', { ascending: false })
    .limit(30)
  const reviews = (reviewRows ?? []) as VendorReview[]

  const session = await getCurrentUser()

  return (
    <main className="lx-page pb-32">
      <VendorMenuClient vendor={{ ...vendor, kyc_verified } as VendorInfo} menu={menuWithAddons} reviews={reviews} loggedOut={!session} />
      {vendor.slug && (
        <div className="max-w-xl mx-auto px-4 pb-4 text-center">
          {/* Link to the public, shareable SEO page for this vendor. Useful for
              sharing and discovery; the /uturu page is the canonical public one. */}
          <Link
            href={vendorPath(vendor.slug)}
            className="lx-btn-ghost inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm"
            style={{ minHeight: 44, borderRadius: 12 }}
          >
            View {vendor.shop_name}&apos;s public page
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
          </Link>
        </div>
      )}
      <BottomNav />
    </main>
  )
}

export interface VendorReview {
  id: string
  stars: number
  review: string | null
  created_at: string
}

export interface MenuAddon {
  id: string
  name: string
  price_kobo: number
}

export interface VendorInfo {
  id: string
  shop_name: string
  owner_name: string
  logo_url: string | null
  shop_photo_url: string | null
  prep_time_minutes: number
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  category: string
  description: string | null
  avg_rating: number
  total_ratings: number
  opening_time: string | null
  closing_time: string | null
  kyc_verified?: boolean
}

export interface MenuItem {
  id: string
  name: string
  description: string | null
  price_kobo: number
  image_url: string | null
  category: string
  is_available: boolean
  prep_time_minutes: number | null
  daily_limit: number | null
  sold_today: number
  display_order: number
  addons: MenuAddon[]
}
