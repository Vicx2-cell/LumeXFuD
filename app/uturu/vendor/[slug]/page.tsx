import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getFeature } from '@/lib/features'
import { formatPrice, formatDate } from '@/lib/money'
import { Breadcrumbs } from '@/components/seo/breadcrumbs'
import { SITE_URL, PLACE, seoUrl, vendorPath } from '@/lib/seo/config'
import { allInKobo } from '@/lib/seo/pricing'
import { buildVendorJsonLd } from '@/lib/seo/jsonld'
import { getSeoVendorBySlug, type SeoVendor, type SeoMenuItem } from '@/lib/seo/vendor-data'

// Rendered dynamically (server-side) per request — NOT force-static/ISR. The
// app's root layout is `force-dynamic`; a force-static page nested under it
// compiles but throws "Dynamic server usage" at on-demand generation. Dynamic
// SSR here still ships ZERO client JS, so the page stays fast and fully
// crawlable, and a newly-onboarded vendor appears immediately (no rebuild).
// Making /uturu truly static/ISR would require its own root layout (route
// group) — a separate, larger change, tracked as a follow-up.
export const dynamic = 'force-dynamic'

// ── Unique, data-driven metadata per page (no token-swap templates) ──────────
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const v = await getSeoVendorBySlug(slug)
  if (!v) return { title: 'Vendor not found', robots: { index: false, follow: false } }

  const fromAllIn = v.priceStats ? formatPrice(allInKobo(v.priceStats.minKobo, v.fees)) : null
  const title = `${v.shopName} — menu & all-in prices near ${PLACE.campusShort}, ${PLACE.town}`
  const ratingBit = v.totalRatings > 0
    ? `Rated ${v.avgRating.toFixed(1)}★ by ${v.totalRatings} ${v.totalRatings === 1 ? 'student' : 'students'}.`
    : 'New on LumeX.'
  const priceBit = fromAllIn ? `Meals from ${fromAllIn} delivered (all-in, no surprises).` : ''
  const description =
    `${v.shopName} (${v.category}) on LumeX Fud. ${priceBit} See the full menu with honest all-in prices, ` +
    `opening hours, and typical ${v.deliveryWindow.minMinutes}–${v.deliveryWindow.maxMinutes} min delivery to your ` +
    `${PLACE.campusShort} hostel. ${ratingBit}`.replace(/\s+/g, ' ').trim()

  const canonical = vendorPath(v.slug)
  const ogImg = v.shopPhotoUrl || v.logoUrl || `${SITE_URL}/icons/icon-512-v2.png`
  return {
    title: { absolute: `${title} · LumeX Fud` },
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website', url: seoUrl(canonical), siteName: 'LumeX Fud',
      title, description, images: [{ url: ogImg, alt: v.shopName }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImg] },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  RICE: 'Rice', PROTEIN: 'Protein', DRINKS: 'Drinks', SNACKS: 'Snacks', OTHER: 'More',
}

export default async function VendorSeoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const v = await getSeoVendorBySlug(slug)
  if (!v) notFound()

  // Trust copy that costs us something is gated to what is actually TRUE: escrow
  // (LumeX holds the money) only when ordering is live. Never a hardcoded promise.
  const orderingLive = await getFeature('ordering')

  const jsonLd = buildVendorJsonLd(v)
  const orderHref = `/vendor/${v.id}`

  return (
    <article className="max-w-3xl mx-auto px-5 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Breadcrumbs items={[
        { name: 'Home', href: '/' },
        // 'Food in Uturu' hub (T4) is not built yet — shown as plain text, not a
        // link, so there is no 404 in the crawl path. Wire the href when T4 ships.
        { name: `Food in ${PLACE.town}` },
        { name: v.shopName },
      ]} />

      <VendorHero v={v} />

      {/* ── All-in price honesty (guardrail §6: no checkout surprise) ── */}
      <PriceBreakdown v={v} />

      {/* ── Trust layer — escrow + verification, capability-gated ── */}
      <TrustPanel v={v} orderingLive={orderingLive} />

      {/* ── Menu with honest all-in prices ── */}
      <MenuSection v={v} />

      {/* ── Reviews — real or honest empty state ── */}
      <ReviewsSection v={v} />

      {/* ── Areas served ── */}
      <AreasSection v={v} />

      {/* ── Single primary CTA ── */}
      <div className="mt-10 glass-thick p-6 text-center space-y-3 rounded-2xl">
        <h2 className="lx-display text-xl font-bold">Order from {v.shopName}</h2>
        <p className="text-sm text-white/60">
          Live menu, real-time status and secure payment in the LumeX app. Your money is held until your food arrives.
        </p>
        <Link href={orderHref} className="lx-btn-amber inline-flex items-center justify-center px-8 py-3.5 text-base" style={{ minHeight: 52, borderRadius: 14 }}>
          Order on LumeX
        </Link>
      </div>

      {/* ── Honest maintenance signal (guardrail §6) ── */}
      <p className="mt-6 text-center text-xs text-white/35">
        Prices and menu verified {formatDate(v.updatedAt)} · {PLACE.areaLine}
      </p>
    </article>
  )
}

// ─── Sections ────────────────────────────────────────────────────────────────

function StatusDot({ v }: { v: SeoVendor }) {
  const color = v.open.reason === 'OPEN' ? 'var(--lx-green)'
    : v.open.reason === 'BUSY' ? 'var(--color-amber)'
    : 'var(--lx-red)'
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} aria-hidden="true" />
      {v.open.label}
    </span>
  )
}

function VendorHero({ v }: { v: SeoVendor }) {
  const img = v.shopPhotoUrl || v.logoUrl
  const fromAllIn = v.priceStats ? formatPrice(allInKobo(v.priceStats.minKobo, v.fees)) : null
  return (
    <header className="mb-6">
      <div className="flex items-start gap-4">
        {img ? (
          <div className="relative w-20 h-20 rounded-2xl overflow-hidden shrink-0 border border-white/10">
            <Image src={img} alt={`${v.shopName} logo`} fill sizes="80px" className="object-cover" priority />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-2xl shrink-0 lx-card-amber-soft flex items-center justify-center lx-display text-2xl font-bold lx-amber">
            {v.shopName.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="lx-display text-2xl font-bold leading-tight">{v.shopName}</h1>
          <p className="text-sm text-white/60 mt-0.5">{v.category} · {PLACE.campusShort}, {PLACE.town}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            <StatusDot v={v} />
            {v.totalRatings > 0 ? (
              <span className="text-sm text-white/70">★ {v.avgRating.toFixed(1)} <span className="text-white/45">({v.totalRatings})</span></span>
            ) : (
              <span className="text-sm text-white/45">New — no reviews yet</span>
            )}
            {v.kycVerified && (
              <span className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--lx-green)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
                Verified
              </span>
            )}
          </div>
        </div>
      </div>

      {v.description && <p className="text-white/70 text-sm mt-4 leading-relaxed">{v.description}</p>}

      <div className="grid grid-cols-3 gap-3 mt-5">
        <Fact label="From (all-in)" value={fromAllIn ?? '—'} />
        <Fact label="Typical delivery" value={`${v.deliveryWindow.minMinutes}–${v.deliveryWindow.maxMinutes} min`} />
        <Fact label="On the menu" value={`${v.availableCount} item${v.availableCount === 1 ? '' : 's'}`} />
      </div>
      {v.open.hoursLabel && (
        <p className="text-xs text-white/40 mt-2">Usual hours: {v.open.hoursLabel} · open daily</p>
      )}
    </header>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-thin rounded-xl p-3 text-center">
      <p className="lx-display text-lg font-bold tabular-nums leading-none">{value}</p>
      <p className="text-[11px] text-white/45 mt-1">{label}</p>
    </div>
  )
}

function PriceBreakdown({ v }: { v: SeoVendor }) {
  if (!v.priceStats) return null
  const { fees } = v
  const cheapestItem = v.priceStats.cheapest
  const itemKobo = cheapestItem.priceKobo
  const total = allInKobo(itemKobo, fees)
  return (
    <section className="mt-6 lx-card-amber-soft rounded-2xl p-5" aria-labelledby="price-h">
      <h2 id="price-h" className="lx-display text-base font-bold">What you actually pay</h2>
      <p className="text-xs text-white/55 mt-1">
        The price you see at checkout — no surprises. Example for the cheapest item, with bike delivery:
      </p>
      <dl className="mt-3 text-sm space-y-1.5">
        <Row k={`${cheapestItem.name}`} val={formatPrice(itemKobo)} />
        <Row k="Platform fee" val={formatPrice(fees.platformMarkupKobo)} />
        <Row k="Bike delivery" val={formatPrice(fees.bikeFeeKobo)} />
        <div className="h-px bg-white/10 my-1.5" />
        <Row k="You pay" val={formatPrice(total)} strong />
      </dl>
      <p className="text-xs text-white/45 mt-3">
        Door-to-room delivery is {formatPrice(fees.doorFeeKobo)} instead of {formatPrice(fees.bikeFeeKobo)}.
        Minimum order {formatPrice(fees.minOrderKobo)}. Prices across the menu run
        {' '}{formatPrice(allInKobo(v.priceStats.minKobo, fees))}–{formatPrice(allInKobo(v.priceStats.maxKobo, fees))} all-in.
      </p>
    </section>
  )
}

function Row({ k, val, strong = false }: { k: string; val: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? 'font-semibold' : 'text-white/65'}>{k}</dt>
      <dd className={`tabular-nums ${strong ? 'font-bold lx-amber' : 'text-white/80'}`}>{val}</dd>
    </div>
  )
}

function TrustPanel({ v, orderingLive }: { v: SeoVendor; orderingLive: boolean }) {
  return (
    <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {orderingLive && (
        <div className="glass-thin rounded-2xl p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--lx-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Your money is protected
          </h3>
          <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
            You don&apos;t pay the vendor directly. LumeX holds your payment and only releases it after your
            food is delivered — and you have a window to report a problem if anything&apos;s wrong.
          </p>
        </div>
      )}
      <div className="glass-thin rounded-2xl p-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={v.kycVerified ? 'var(--lx-green)' : 'var(--color-amber)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
          {v.kycVerified ? 'Identity verified' : 'On the LumeX platform'}
        </h3>
        <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
          {v.kycVerified
            ? `${v.shopName} completed LumeX identity verification — a real, accountable vendor, not an anonymous DM.`
            : `${v.shopName} is an onboarded LumeX vendor. Orders, payment and delivery all run through the platform.`}
        </p>
      </div>
    </section>
  )
}

function MenuSection({ v }: { v: SeoVendor }) {
  if (v.menu.length === 0) {
    return (
      <section className="mt-8">
        <h2 className="lx-display text-xl font-bold mb-3">Menu</h2>
        <p className="text-sm text-white/50 glass-thin rounded-2xl p-5">
          {v.shopName}&apos;s menu is being set up. Check back soon, or open LumeX to see the latest.
        </p>
      </section>
    )
  }
  // Group available items by category, keep menu order.
  const order = ['RICE', 'PROTEIN', 'SNACKS', 'DRINKS', 'OTHER']
  const groups = new Map<string, SeoMenuItem[]>()
  for (const m of v.menu) {
    const arr = groups.get(m.category) ?? []
    arr.push(m)
    groups.set(m.category, arr)
  }
  const cats = [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return (
    <section className="mt-8">
      <h2 className="lx-display text-xl font-bold mb-1">Menu &amp; prices</h2>
      <p className="text-xs text-white/45 mb-4">All prices below are the item only. Add the platform fee + delivery for your all-in total (see above).</p>
      <div className="space-y-6">
        {cats.map((cat) => (
          <div key={cat}>
            <h3 className="lx-eyebrow lx-amber mb-3">{CATEGORY_LABEL[cat] ?? cat}</h3>
            <ul className="space-y-2.5">
              {groups.get(cat)!.map((m) => (
                <li key={m.id} className="glass-thin rounded-xl p-3 flex items-center gap-3">
                  {m.imageUrl ? (
                    <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-white/8">
                      <Image src={m.imageUrl} alt={m.name} fill sizes="56px" loading="lazy" className="object-cover" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{m.name}</p>
                      {!m.isAvailable && <span className="text-[10px] uppercase tracking-wide text-white/40 border border-white/15 rounded px-1.5 py-0.5 shrink-0">Sold out today</span>}
                    </div>
                    {m.description && <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{m.description}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="lx-amber font-bold tabular-nums">{formatPrice(m.priceKobo)}</p>
                    <p className="text-[10px] text-white/40 tabular-nums">{formatPrice(allInKobo(m.priceKobo, v.fees))} all-in</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function ReviewsSection({ v }: { v: SeoVendor }) {
  const withText = v.reviews.filter((r) => r.review && r.review.trim())
  return (
    <section className="mt-8">
      <h2 className="lx-display text-xl font-bold mb-3">Student reviews</h2>
      {v.totalRatings === 0 ? (
        <p className="text-sm text-white/50 glass-thin rounded-2xl p-5">
          No reviews yet — {v.shopName} is new on LumeX. Be the first to order and leave an honest review.
        </p>
      ) : (
        <>
          <p className="text-sm text-white/70 mb-3">
            {v.avgRating.toFixed(1)}★ average from {v.totalRatings} {v.totalRatings === 1 ? 'verified order' : 'verified orders'}.
          </p>
          {withText.length > 0 && (
            <ul className="space-y-2.5">
              {withText.slice(0, 8).map((r) => (
                <li key={r.id} className="glass-thin rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="lx-amber text-sm" aria-label={`${r.stars} out of 5 stars`}>{'★'.repeat(r.stars)}<span className="text-white/20">{'★'.repeat(5 - r.stars)}</span></span>
                    <span className="text-[11px] text-white/40">{formatDate(r.createdAt)}</span>
                  </div>
                  <p className="text-sm text-white/75 mt-1.5 leading-relaxed">{r.review}</p>
                  <p className="text-[11px] text-white/35 mt-1.5">Verified LumeX customer</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function AreasSection({ v }: { v: SeoVendor }) {
  if (v.areasServed.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="lx-display text-xl font-bold mb-1">Delivery around {PLACE.campusShort}</h2>
      <p className="text-xs text-white/55 mb-3">
        {v.shopName} delivers to lodges across {PLACE.town} — typically {v.deliveryWindow.minMinutes}–{v.deliveryWindow.maxMinutes} minutes from order to door.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {v.areasServed.slice(0, 24).map((name) => (
          <span key={name} className="text-xs text-white/60 border border-white/12 rounded-full px-2.5 py-1">{name}</span>
        ))}
      </div>
    </section>
  )
}
