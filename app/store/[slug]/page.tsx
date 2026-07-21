import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'
import { SITE_URL, seoUrl } from '@/lib/seo/config'
import { getSeoVendorBySlug } from '@/lib/seo/vendor-data'
import { isReservedStoreSlug, normalizeStoreSlug, storePath } from '@/lib/storefront'
import VendorPage from '@/app/vendor/[id]/page'

export const dynamic = 'force-dynamic'

type StoreParams = { slug: string }
type StoreSearch = { campaign?: string }

export async function generateMetadata({ params }: { params: Promise<StoreParams> }): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = normalizeStoreSlug(rawSlug)
  if (!slug || isReservedStoreSlug(slug)) {
    return { title: 'Store not found', robots: { index: false, follow: false } }
  }

  const vendor = await getSeoVendorBySlug(slug)
  if (!vendor) return { title: 'Store not found', robots: { index: false, follow: false } }

  const path = storePath(vendor.slug)
  const title = `${vendor.shopName} menu and ordering`
  const description = `${vendor.shopName} on LumeX Fud. Browse the live menu, configure items, and checkout from this vendor storefront.`
  const image = vendor.shopPhotoUrl || vendor.logoUrl || `${SITE_URL}/icons/icon-512-v2.png`

  return {
    title: { absolute: `${title} - LumeX Fud` },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      url: seoUrl(path),
      siteName: 'LumeX Fud',
      title,
      description,
      images: [{ url: image, alt: vendor.shopName }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  }
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<StoreParams>
  searchParams?: Promise<StoreSearch>
}) {
  const { slug: rawSlug } = await params
  const slug = normalizeStoreSlug(rawSlug)
  if (!slug || isReservedStoreSlug(slug)) notFound()
  if (slug !== rawSlug) redirect(storePath(slug))

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .is('deleted_at', null)
    .or(notCurrentlySuspendedOr())
    .maybeSingle()

  if (!vendor?.id || !vendor.slug) notFound()
  if (vendor.slug !== slug) redirect(storePath(String(vendor.slug)))

  const search = ((await (searchParams ?? Promise.resolve({})).catch(() => ({}))) as StoreSearch)
  return VendorPage({
    params: Promise.resolve({ id: String(vendor.id) }),
    searchParams: Promise.resolve({ campaign: search.campaign }),
  })
}
