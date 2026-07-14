import { formatPrice, isValidKoboAmount } from '@/lib/money'

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

export type DiscoveryTopicSlug =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'student-budget'
  | 'late-night'
  | 'rice'
  | 'shawarma'
  | 'pizza'
  | 'drinks'
  | 'absu'
  | 'uturu'

export interface DiscoveryModule {
  title: string
  subtitle: string
  badge: string
  items: Array<{
    title: string
    subtitle: string
    priceLabel?: string
    href?: string
  }>
}

const TOPIC_RULES: Array<{ slug: DiscoveryTopicSlug; label: string; terms: string[] }> = [
  { slug: 'breakfast', label: 'Breakfast', terms: ['breakfast', 'egg', 'tea', 'coffee', 'porridge'] },
  { slug: 'lunch', label: 'Lunch', terms: ['rice', 'jollof', 'beans', 'swallow', 'amala'] },
  { slug: 'dinner', label: 'Dinner', terms: ['shawarma', 'pizza', 'chicken', 'burger', 'noodles'] },
  { slug: 'student-budget', label: 'Student Budget', terms: ['budget', 'cheap', 'student', 'small money', 'student budget'] },
  { slug: 'late-night', label: 'Late Night', terms: ['late night', 'night', 'after 10', 'closing soon'] },
  { slug: 'rice', label: 'Rice', terms: ['rice', 'jollof', 'fried rice', 'ofada', 'coconut rice'] },
  { slug: 'shawarma', label: 'Shawarma', terms: ['shawarma'] },
  { slug: 'pizza', label: 'Pizza', terms: ['pizza'] },
  { slug: 'drinks', label: 'Drinks', terms: ['drink', 'juice', 'zobo', 'smoothie', 'malt', 'soda', 'water'] },
  { slug: 'absu', label: 'ABSU', terms: ['absu'] },
  { slug: 'uturu', label: 'Uturu', terms: ['uturu'] },
]

export function topicPathForLabel(label: string) {
  const cleaned = label.replace(/^#/, '').trim().toLowerCase()
  const match = TOPIC_RULES.find((rule) => rule.label.toLowerCase() === cleaned || rule.slug === cleaned)
  return `/topic/${match?.slug ?? cleaned.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
}

function normaliseText(value?: string | null) {
  return String(value ?? '').toLowerCase()
}

function itemText(item: FeedDiscoveryItem) {
  const menuText = (item.menuItems ?? []).map((menu) => menu?.name ?? '').join(' ')
  return [
    item.authorDisplayName,
    item.authorHandle,
    item.body,
    menuText,
    ...(item.hashtags ?? []),
    item.postKind,
  ].map((part) => normaliseText(part)).join(' ')
}

export function classifyDiscoveryTopics(item: FeedDiscoveryItem): DiscoveryTopicSlug[] {
  const text = itemText(item)
  return TOPIC_RULES
    .filter((rule) => rule.terms.some((term) => text.includes(term)))
    .map((rule) => rule.slug)
}

export function getDiscoveryTopicLabels(items: FeedDiscoveryItem[], limit = 8): TrendingTopic[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const slug of classifyDiscoveryTopics(item)) {
      const rule = TOPIC_RULES.find((entry) => entry.slug === slug)
      if (!rule) continue
      counts.set(rule.label, (counts.get(rule.label) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }))
}

export function buildDiscoveryModules(items: FeedDiscoveryItem[]): DiscoveryModule[] {
  const sorted = items.slice().sort((a, b) => {
    const aPrimary = a.menuItems?.find((item) => item.isPrimary) ?? a.menuItems?.[0]
    const bPrimary = b.menuItems?.find((item) => item.isPrimary) ?? b.menuItems?.[0]
    const aScore = Number(aPrimary?.priceKobo ?? 0) + (a.postKind === 'PROMOTION' ? 500 : 0)
    const bScore = Number(bPrimary?.priceKobo ?? 0) + (b.postKind === 'PROMOTION' ? 500 : 0)
    return aScore - bScore
  })
  const primary = sorted.find((item) => (item.menuItems ?? []).length > 0)
  const budget = sorted.find((item) => {
    const price = item.menuItems?.find((menu) => menu.isPrimary) ?? item.menuItems?.[0]
    return Boolean(price?.priceKobo && price.priceKobo <= 300000)
  })
  const lateNight = sorted.find((item) => classifyDiscoveryTopics(item).includes('late-night'))
  const meals = sorted.slice(0, 3).map((item) => {
    const menu = item.menuItems?.find((menuItem) => menuItem.isPrimary) ?? item.menuItems?.[0]
    const priceLabel = menu?.priceKobo && isValidKoboAmount(menu.priceKobo) ? formatPrice(menu.priceKobo) : undefined
    return {
      title: menu?.name ?? item.body?.split('\n')[0]?.slice(0, 48) ?? 'Meal',
      subtitle: item.authorDisplayName ?? item.authorHandle ?? 'Vendor',
      priceLabel,
    }
  })

  const modules: DiscoveryModule[] = []
  if (meals.length > 0) {
    modules.push({
      title: 'Trending Meals',
      subtitle: 'Hot food posts people are actually engaging with.',
      badge: 'Trending',
      items: meals,
    })
  }
  if (primary) {
    const menu = primary.menuItems?.find((menuItem) => menuItem.isPrimary) ?? primary.menuItems?.[0]
    modules.push({
      title: 'New Nearby Vendors',
      subtitle: 'Fresh vendor activity from the live feed.',
      badge: 'New',
      items: [{
        title: primary.authorDisplayName ?? primary.authorHandle ?? 'Vendor',
        subtitle: menu?.name ?? 'Recent post',
        priceLabel: menu?.priceKobo && isValidKoboAmount(menu.priceKobo) ? formatPrice(menu.priceKobo) : undefined,
      }],
    })
  }
  if (budget) {
    const menu = budget.menuItems?.find((menuItem) => menuItem.isPrimary) ?? budget.menuItems?.[0]
    modules.push({
      title: 'Student Budget',
      subtitle: 'Cheaper meals from the same real vendors.',
      badge: 'Budget',
      items: [{
        title: menu?.name ?? 'Budget meal',
        subtitle: budget.authorDisplayName ?? budget.authorHandle ?? 'Vendor',
        priceLabel: menu?.priceKobo && isValidKoboAmount(menu.priceKobo) ? formatPrice(menu.priceKobo) : undefined,
      }],
    })
  }
  if (lateNight) {
    const menu = lateNight.menuItems?.find((menuItem) => menuItem.isPrimary) ?? lateNight.menuItems?.[0]
    modules.push({
      title: 'Late Night Eats',
      subtitle: 'Real meals that fit the later hours.',
      badge: 'Night',
      items: [{
        title: menu?.name ?? 'Late-night pick',
        subtitle: lateNight.authorDisplayName ?? lateNight.authorHandle ?? 'Vendor',
        priceLabel: menu?.priceKobo && isValidKoboAmount(menu.priceKobo) ? formatPrice(menu.priceKobo) : undefined,
      }],
    })
  }
  return modules.slice(0, 4)
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
      const priceLabel = primary && isValidKoboAmount(primary.priceKobo) && primary.priceKobo > 0
        ? formatPrice(primary.priceKobo)
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
