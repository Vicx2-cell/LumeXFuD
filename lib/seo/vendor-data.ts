import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getControls, withinHours } from '@/lib/controls'
import { getPlatformFees, type PlatformFees } from './pricing'

// ── The vendor dataset (the spine for T1 /uturu/vendor/[slug]) ───────────────
// One module = one composed query per vendor. Everything a page needs is built
// here from REAL columns only; the template stays presentational. No fabricated
// fields — if data is absent the page shows an honest empty state, never a guess.

export interface SeoMenuItem {
  id: string
  name: string
  description: string | null
  priceKobo: number
  imageUrl: string | null
  category: string
  isAvailable: boolean
}

export interface SeoReview {
  id: string
  stars: number
  review: string | null
  createdAt: string
}

export interface SeoVendor {
  id: string
  slug: string
  shopName: string
  description: string | null
  category: string
  logoUrl: string | null
  shopPhotoUrl: string | null
  prepTimeMinutes: number
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  openingTime: string | null
  closingTime: string | null
  avgRating: number
  totalRatings: number
  kycVerified: boolean
  updatedAt: string

  // Derived
  menu: SeoMenuItem[]
  availableCount: number
  /** kobo price stats across AVAILABLE items (null when no items). */
  priceStats: { minKobo: number; medianKobo: number; maxKobo: number; cheapest: SeoMenuItem } | null
  reviews: SeoReview[]
  open: OpenState
  fees: PlatformFees
  /** Active campus lodges this vendor delivers to (single campus → all of them). */
  areasServed: string[]
  /** typical door-to-door window in minutes, derived from prep time. */
  deliveryWindow: { minMinutes: number; maxMinutes: number }
}

export interface OpenState {
  isOpen: boolean
  /** 'OPEN' | 'BUSY' | 'CLOSED_VENDOR' | 'CLOSED_HOURS' */
  reason: 'OPEN' | 'BUSY' | 'CLOSED_VENDOR' | 'CLOSED_HOURS'
  label: string
  hoursLabel: string | null   // vendor's own "8am – 9pm" if set
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

// Honest open/closed: NEVER default to open. A vendor is open only when BOTH the
// platform is within operating hours AND the vendor's own status is OPEN/BUSY.
function deriveOpen(
  status: 'OPEN' | 'BUSY' | 'CLOSED',
  controls: Awaited<ReturnType<typeof getControls>>,
  opening: string | null,
  closing: string | null,
): OpenState {
  const hoursLabel = opening && closing ? `${fmt(opening)} – ${fmt(closing)}` : null
  // Platform-hour gate only bites when the super-admin enforces hours; otherwise
  // the vendor's own status is the source of truth (mirrors order gating).
  const platformOpen = withinHours(controls)
  if (!platformOpen) {
    return { isOpen: false, reason: 'CLOSED_HOURS', label: 'Closed — outside campus hours', hoursLabel }
  }
  if (status === 'CLOSED') {
    return { isOpen: false, reason: 'CLOSED_VENDOR', label: 'Closed now', hoursLabel }
  }
  if (status === 'BUSY') {
    return { isOpen: true, reason: 'BUSY', label: 'Open · busy', hoursLabel }
  }
  return { isOpen: true, reason: 'OPEN', label: 'Open now', hoursLabel }
}

function fmt(t: string): string {
  const [h, m] = t.split(':')
  let hh = parseInt(h, 10)
  if (!Number.isFinite(hh)) return t
  const ampm = hh >= 12 ? 'pm' : 'am'
  hh = hh % 12 || 12
  const mm = m && m !== '00' ? `:${m}` : ''
  return `${hh}${mm}${ampm}`
}

interface VendorRow {
  id: string; slug: string | null; shop_name: string; description: string | null
  category: string; logo_url: string | null; shop_photo_url: string | null
  prep_time_minutes: number; status: 'OPEN' | 'BUSY' | 'CLOSED'
  opening_time: string | null; closing_time: string | null
  avg_rating: number | null; total_ratings: number | null; updated_at: string
}

/** Full composed dataset for one vendor by slug, or null if no public match. */
export async function getSeoVendorBySlug(slug: string): Promise<SeoVendor | null> {
  const db = createSupabaseAdmin()

  const { data } = await db
    .from('vendors')
    .select(`
      id, slug, shop_name, description, category, logo_url, shop_photo_url,
      prep_time_minutes, status, opening_time, closing_time,
      avg_rating, total_ratings, updated_at
    `)
    .eq('slug', slug)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data) return null
  const v = data as VendorRow

  const [{ data: menuRows }, { data: reviewRows }, controls, fees, kycVerified, areasServed] =
    await Promise.all([
      db.from('menu_items')
        .select('id, name, description, price_kobo, image_url, category, is_available')
        .eq('vendor_id', v.id)
        .is('deleted_at', null)
        .order('display_order', { ascending: true }),
      db.from('ratings')
        .select('id, stars, review, created_at')
        .eq('vendor_id', v.id)
        .order('created_at', { ascending: false })
        .limit(20),
      getControls(),
      getPlatformFees(),
      isKycVerified(db, v.id),
      listActiveLodgeNames(db),
    ])

  const menu: SeoMenuItem[] = (menuRows ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    description: (m.description as string | null) ?? null,
    priceKobo: Number(m.price_kobo),
    imageUrl: (m.image_url as string | null) ?? null,
    category: m.category as string,
    isAvailable: (m.is_available as boolean) ?? true,
  }))

  const available = menu.filter((m) => m.isAvailable)
  const prices = available.map((m) => m.priceKobo).sort((a, b) => a - b)
  const priceStats = available.length
    ? {
        minKobo: prices[0],
        medianKobo: median(prices),
        maxKobo: prices[prices.length - 1],
        cheapest: available.reduce((lo, m) => (m.priceKobo < lo.priceKobo ? m : lo), available[0]),
      }
    : null

  const reviews: SeoReview[] = (reviewRows ?? []).map((r) => ({
    id: r.id as string,
    stars: Number(r.stars),
    review: (r.review as string | null) ?? null,
    createdAt: r.created_at as string,
  }))

  const prep = v.prep_time_minutes ?? 25

  return {
    id: v.id,
    slug: v.slug ?? slug,
    shopName: v.shop_name,
    description: v.description,
    category: v.category,
    logoUrl: v.logo_url,
    shopPhotoUrl: v.shop_photo_url,
    prepTimeMinutes: prep,
    status: v.status,
    openingTime: v.opening_time,
    closingTime: v.closing_time,
    avgRating: Number(v.avg_rating ?? 0),
    totalRatings: Number(v.total_ratings ?? 0),
    kycVerified,
    updatedAt: v.updated_at,
    menu,
    availableCount: available.length,
    priceStats,
    reviews,
    open: deriveOpen(v.status, controls, v.opening_time, v.closing_time),
    fees,
    areasServed,
    // Honest estimate: prep + a typical 10–15 min campus ride. Labelled as typical
    // on the page; the live order page shows the real ETA.
    deliveryWindow: { minMinutes: prep + 10, maxMinutes: prep + 15 },
  }
}

async function isKycVerified(db: ReturnType<typeof createSupabaseAdmin>, vendorId: string): Promise<boolean> {
  try {
    const { data } = await db.storage.from('kyc-faces').createSignedUrl(`complete/${vendorId}`, 60)
    return !!data
  } catch {
    return false
  }
}

async function listActiveLodgeNames(db: ReturnType<typeof createSupabaseAdmin>): Promise<string[]> {
  try {
    const { data } = await db
      .from('lodges')
      .select('name')
      .eq('is_active', true)
      .order('name', { ascending: true })
    return (data ?? []).map((l) => l.name as string).filter(Boolean)
  } catch {
    return []
  }
}

// ── List for generateStaticParams + sitemap ──────────────────────────────────
export interface SeoVendorRef { slug: string; updatedAt: string }

export async function listSeoVendors(): Promise<SeoVendorRef[]> {
  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('vendors')
      .select('slug, updated_at')
      .eq('is_active', true)
      .is('deleted_at', null)
      .not('slug', 'is', null)
    return (data ?? [])
      .filter((r) => r.slug)
      .map((r) => ({ slug: r.slug as string, updatedAt: (r.updated_at as string) ?? new Date(0).toISOString() }))
  } catch {
    return []
  }
}
