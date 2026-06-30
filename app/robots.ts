import type { MetadataRoute } from 'next'

const SITE = 'https://lumexfud.com.ng'

// Let search engines crawl the public marketing pages; keep the app/private
// areas (auth, dashboards, APIs, personal pages) out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/', '/auth', '/home', '/cart', '/orders', '/order/',
          '/profile', '/admin', '/super-admin', '/vendor-dashboard',
          '/rider', '/leaderboard', '/ping',
          // The in-app order page (UUID URL, dynamic, login-to-order) — kept out
          // of the index so the canonical public page is /uturu/vendor/[slug].
          // Prevents two URLs competing for the same vendor query.
          '/vendor/',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  }
}
