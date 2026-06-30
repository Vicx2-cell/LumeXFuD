// Shared constants for the public Uturu Food Graph (programmatic SEO pages under
// /uturu). Kept in one place so titles, canonicals and JSON-LD never drift.

export const SITE_URL = 'https://lumexfud.com.ng'

// Place vocabulary — used verbatim in copy + structured data. These are the real
// local entities we rank for; do not abbreviate or invent variants.
export const PLACE = {
  campus: 'Abia State University (ABSU)',
  campusShort: 'ABSU',
  town: 'Uturu',
  state: 'Abia State',
  country: 'Nigeria',
  // Human-readable area line used across pages.
  areaLine: 'Uturu, Abia State, Nigeria',
  areaServed: 'Abia State University (ABSU), Uturu, Abia State, Nigeria',
} as const

// How long a statically-rendered SEO page is cached before ISR revalidates it.
// Prices/menus change rarely; an hour keeps pages fresh enough while serving
// static HTML to crawlers and 2G users. The vendor's live OPEN/BUSY/CLOSED dot
// is the one thing that can lag up to this long — we label it "as of {date}" and
// the in-app order page (linked by the CTA) always shows the real-time status.
export const SEO_REVALIDATE_SECONDS = 3600

export const seoUrl = (path: string) => `${SITE_URL}${path}`

export const vendorPath = (slug: string) => `/uturu/vendor/${slug}`
