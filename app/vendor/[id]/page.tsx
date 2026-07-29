import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'
import { getCurrentUser } from '@/lib/session'
import { BottomNav } from '@/components/nav-bottom'
import { vendorPath } from '@/lib/seo/config'
import { VendorMenuClient } from './vendor-menu-client'
import type { MenuAddon, MenuItem, VendorInfo, VendorReview } from './types'

// Always render fresh — a vendor's menu, prices and open/closed status must not
// be served stale from a cached page.
export const dynamic = 'force-dynamic'

export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ campaign?: string; item?: string }>
}) {
  const { id } = await params
  const search = ((await (searchParams ?? Promise.resolve({})).catch(() => ({}))) as { campaign?: string; item?: string })
  const db = createSupabaseAdmin()

  const { data: vendor } = await db
    .from('vendors')
    .select(`
      id, slug, shop_name, owner_name, logo_url, shop_photo_url,
      prep_time_minutes, status, paused_until, category, description,
      avg_rating, total_ratings, is_active, opening_time, closing_time,
      address_text, landmark, latitude, longitude, location_photo_url
    `)
    .eq('id', id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .or(notCurrentlySuspendedOr()) // a suspended vendor's storefront 404s
    .single()

  if (!vendor) notFound()

  const { data: vendorProfile } = await db
    .from('social_profiles')
    .select('id')
    .eq('vendor_id', id)
    .maybeSingle()

  const vendorProfileId = (vendorProfile as { id?: string } | null)?.id ?? null
  const { data: recentPostRows } = vendorProfileId
    ? await db.from('posts').select('id, body, post_kind, published_at').eq('author_profile_id', vendorProfileId).eq('status', 'published').eq('is_archived', false).is('deleted_at', null).order('published_at', { ascending: false }).limit(3)
    : { data: [] }
  const recentPosts = (recentPostRows ?? []) as Array<{ id: string; body: string | null; post_kind: string; published_at: string | null }>

  const session = await getCurrentUser()

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
      .select('id, menu_item_id, name, price_kobo, is_required')
      .in('menu_item_id', itemIds)
      .eq('is_available', true)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
    for (const a of (addonRows ?? []) as Array<MenuAddon & { menu_item_id: string }>) {
      const arr = byItem.get(a.menu_item_id) ?? []
      arr.push({ id: a.id, name: a.name, price_kobo: a.price_kobo, is_required: Boolean(a.is_required) })
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

  return (
    <main className="lx-page feed-dark pb-32">
      <VendorMenuClient
        vendor={{ ...vendor, kyc_verified } as VendorInfo}
        menu={menuWithAddons}
        reviews={reviews}
        loggedOut={!session}
        campaignId={search?.campaign ?? ''}
        initialMenuItemId={search?.item ?? ''}
      />
      {recentPosts.length > 0 ? (
        <section className="mx-auto max-w-5xl px-4 pb-8 sm:px-6 lg:px-8" aria-labelledby="vendor-updates-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="vendor-updates-title" className="text-lg font-semibold text-white">Latest updates</h2>
            {vendorProfileId ? <Link href={`/feed-v2/profile/${vendorProfileId}`} className="text-sm font-semibold text-[#F5A623]">View all</Link> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {recentPosts.map((post) => (
              <Link key={post.id} href={`/feed-v2/post/${post.id}`} className="min-h-28 rounded-lg border border-white/8 bg-white/[0.03] p-4 transition hover:border-white/16">
                <p className="text-xs font-semibold uppercase text-white/40">{post.post_kind.replaceAll('_', ' ')}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/80">{post.body?.trim() || 'Open this vendor update.'}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
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
