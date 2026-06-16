import type { MetadataRoute } from 'next'

const SITE = 'https://lumexfud.com.ng'

// Public, indexable pages only. App pages require login and are excluded (also
// disallowed in robots.ts). /auth/register is the public sign-up entry point.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/auth/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
