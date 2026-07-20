import type { MetadataRoute } from 'next'
import { listSeoVendors } from '@/lib/seo/vendor-data'
import { listGuides, guidePath } from '@/lib/seo/guides'

const SITE = 'https://lumexfud.com.ng'

// Generated per request (cheap single query) so a newly-onboarded vendor enters
// the sitemap immediately — no build/revalidate lag. Crawlers re-read on their
// own cadence; serving the live list keeps it always correct.
export const dynamic = 'force-dynamic'

// Public, indexable pages. App pages require login and are excluded (also
// disallowed in robots.ts). The /uturu/* content pages are the SEO surface.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/auth/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]

  // T1 — vendor pages (one per real, active, onboarded vendor).
  const vendors = await listSeoVendors()
  const vendorPages: MetadataRoute.Sitemap = vendors.map((v) => ({
    url: `${SITE}/uturu/vendor/${v.slug}`,
    lastModified: new Date(v.updatedAt),
    changeFrequency: 'daily',
    priority: 0.8,
  }))

  // T5 — guide / FAQ pages (evergreen, lightly updated).
  const guidePages: MetadataRoute.Sitemap = listGuides().map((g) => ({
    url: `${SITE}${guidePath(g.slug)}`,
    lastModified: new Date(g.updated),
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  return [...staticPages, ...vendorPages, ...guidePages]
}
