import { formatPrice } from '@/lib/money'

export interface FeedDiscoveryItem {
  authorDisplayName?: string | null
  authorHandle?: string | null
  hashtags?: string[] | null
  postKind?: string | null
  body?: string | null
  menuItems?: Array<{
    name?: string | null
    priceKobo?: number | null
    isPrimary?: boolean | null
  }> | null
}

export interface TrendingTopic {
  label: string
  count: number
}

export interface FeaturedVendor {
  name: string
  handle: string
  count: number
}

export interface CampusDeal {
  title: string
  vendor: string
  priceLabel: string
  badge: string
}

export function getTrendingTopics(items: FeedDiscoveryItem[], limit = 5): TrendingTopic[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const tag of (item.hashtags ?? []).slice(0, 5)) {
      const label = tag.startsWith('#') ? tag : `#${tag}`
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }))
}

export function getFeaturedVendors(items: FeedDiscoveryItem[], limit = 5): FeaturedVendor[] {
  const vendors = new Map<string, FeaturedVendor>()
  for (const item of items) {
    const name = item.authorDisplayName ?? item.authorHandle ?? 'Vendor'
    const handle = item.authorHandle ?? item.authorDisplayName ?? 'vendor'
    const key = `${name}:${handle}`
    const prev = vendors.get(key) ?? { name, handle, count: 0 }
    vendors.set(key, { ...prev, count: prev.count + 1 })
  }
  return Array.from(vendors.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export function getCampusDeals(items: FeedDiscoveryItem[], limit = 4): CampusDeal[] {
  return items
    .filter((item) => Boolean(item.menuItems?.length || item.postKind === 'PROMOTION'))
    .slice(0, limit)
    .map((item) => {
      const primary = item.menuItems?.find((menuItem) => menuItem.isPrimary) ?? item.menuItems?.[0]
      const title = primary?.name ?? item.body?.split('\n')[0]?.slice(0, 48) ?? 'Campus deal'
      const priceLabel = primary
        ? formatPrice(primary.priceKobo ?? 0)
        : item.postKind === 'PROMOTION'
          ? 'Promo'
          : 'View menu'
      return {
        title,
        vendor: item.authorDisplayName ?? item.authorHandle ?? 'Vendor',
        priceLabel,
        badge: item.postKind === 'PROMOTION' ? 'Deal' : primary ? 'Menu item' : 'Hot',
      }
    })
}
