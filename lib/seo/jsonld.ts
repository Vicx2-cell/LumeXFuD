import { SITE_URL, PLACE, seoUrl, vendorPath } from './config'
import { allInKobo } from './pricing'
import type { SeoVendor } from './vendor-data'

// JSON-LD builders. Hard rule (guardrail §2.2): NEVER emit AggregateRating/Review
// unless real ratings exist — fabricated review markup is a manual-penalty risk
// and a trust killer. Prices in schema are the honest all-in (incl. delivery).

const naira = (kobo: number) => (kobo / 100).toFixed(2)

// Map our 24h "HH:MM" hours to schema OpeningHoursSpecification (Mon–Sun, since
// the platform runs every day). Only emitted when the vendor set both times.
function openingHours(v: SeoVendor) {
  if (!v.openingTime || !v.closingTime) return undefined
  return {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: v.openingTime,
    closes: v.closingTime,
  }
}

export function buildVendorJsonLd(v: SeoVendor) {
  const url = seoUrl(vendorPath(v.slug))
  const id = `${url}#restaurant`

  // Menu → schema Menu with sections by category, all-in prices.
  const byCat = new Map<string, typeof v.menu>()
  for (const m of v.menu.filter((i) => i.isAvailable)) {
    const arr = byCat.get(m.category) ?? []
    arr.push(m)
    byCat.set(m.category, arr)
  }
  const menuSection = [...byCat.entries()].map(([cat, items]) => ({
    '@type': 'MenuSection',
    name: cat,
    hasMenuItem: items.map((m) => ({
      '@type': 'MenuItem',
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      offers: {
        '@type': 'Offer',
        price: naira(allInKobo(m.priceKobo, v.fees)),
        priceCurrency: 'NGN',
        // Honest: this is the all-in price including platform fee + bike delivery.
        description: 'All-in price including platform fee and bike delivery',
      },
    })),
  }))

  const restaurant: Record<string, unknown> = {
    '@type': 'Restaurant',
    '@id': id,
    name: v.shopName,
    url,
    ...(v.description ? { description: v.description } : {}),
    servesCuisine: v.category,
    ...(v.logoUrl ? { image: v.logoUrl } : v.shopPhotoUrl ? { image: v.shopPhotoUrl } : {}),
    priceRange: '₦₦',
    address: {
      '@type': 'PostalAddress',
      addressLocality: PLACE.town,
      addressRegion: PLACE.state,
      addressCountry: 'NG',
    },
    areaServed: PLACE.areaServed,
    currenciesAccepted: 'NGN',
    paymentAccepted: 'Card, Bank Transfer, USSD',
    ...(menuSection.length ? { hasMenu: { '@type': 'Menu', hasMenuSection: menuSection } } : {}),
  }

  const oh = openingHours(v)
  if (oh) restaurant.openingHoursSpecification = oh

  // Reviews — ONLY when genuine ratings exist. Otherwise omitted entirely.
  if (v.totalRatings > 0 && v.avgRating > 0) {
    restaurant.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: v.avgRating.toFixed(2),
      reviewCount: v.totalRatings,
      bestRating: 5,
      worstRating: 1,
    }
    const withText = v.reviews.filter((r) => r.review && r.review.trim())
    if (withText.length) {
      restaurant.review = withText.slice(0, 10).map((r) => ({
        '@type': 'Review',
        reviewRating: { '@type': 'Rating', ratingValue: r.stars, bestRating: 5, worstRating: 1 },
        author: { '@type': 'Person', name: 'Verified LumeX customer' },
        reviewBody: r.review,
        datePublished: r.createdAt.slice(0, 10),
      }))
    }
  }

  // Home → vendor. The 'Food in Uturu' hub (T4) isn't built yet, so it is left
  // out of the trail rather than pointing schema at a 404. Add it when T4 ships.
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: v.shopName, item: url },
    ],
  }

  return { '@context': 'https://schema.org', '@graph': [restaurant, breadcrumb] }
}
