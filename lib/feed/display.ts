import { formatPrice } from '@/lib/money'
import type { FeedMediaSummary, FeedMenuItemSummary, RankedFeedCandidate } from './types'
import { isValidKoboAmount } from '@/lib/money'

const compactNumberFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
})

export function simpleUsername(value?: string | null) {
  const raw = (value ?? '').trim()
  if (!raw) return 'profile'
  const withoutAt = raw.replace(/^@+/, '')
  const tokens = withoutAt
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
  if (tokens.length > 0 && tokens[0].length >= 3) return tokens[0].slice(0, 16)
  const compact = withoutAt.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!compact) return 'profile'
  return compact.slice(0, 16)
}

export function formatCompactCount(value?: number | null) {
  const count = Number(value ?? 0)
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count < 1000) return String(Math.trunc(count))
  return compactNumberFormatter.format(count)
}

export function formatOfficialFeedHeadline(collectionType?: RankedFeedCandidate['officialCollectionType'] | null) {
  switch (collectionType) {
    case 'morning_collection':
      return 'Good morning'
    case 'evening_collection':
      return 'Late-night picks'
    case 'breakfast_picks':
      return 'Breakfast ideas'
    case 'lunch_picks':
      return 'Lunch ideas'
    case 'dinner_picks':
      return 'Dinner ideas'
    case 'student_budget':
      return 'Meals under budget'
    case 'open_right_now':
      return 'Open now'
    case 'closing_soon':
      return 'Closing soon'
    case 'rice_lovers':
      return 'Rice meals worth a look'
    case 'shawarma_picks':
      return 'Shawarma tonight'
    case 'pizza_friday':
      return 'Pizza Friday'
    case 'drinks_around_you':
      return 'Drinks nearby'
    case 'fast_delivery_picks':
      return 'Fast picks'
    case 'new_vendors':
      return 'New vendors to try'
    case 'new_menus_week':
      return 'New meals this week'
    case 'active_deals':
      return 'Live deals'
    case 'new_on_lumex':
      return 'New on LumeX'
    case 'lumex_picks':
      return 'LumeX picks'
    case 'sponsored':
      return 'Picked for you'
    case 'event':
      return 'Local event'
    default:
      return null
  }
}

export function pickPrimaryMenuItem(menuItems?: FeedMenuItemSummary[] | null): FeedMenuItemSummary | null {
  if (!menuItems || menuItems.length === 0) return null
  return menuItems.find((item) => item.isPrimary) ?? menuItems[0] ?? null
}

export function formatMenuItemPrice(menuItem?: FeedMenuItemSummary | null): string | null {
  if (!menuItem) return null
  if (!isValidKoboAmount(menuItem.priceKobo) || menuItem.priceKobo < 0) return null
  return formatPrice(menuItem.priceKobo)
}

export function resolveFeedHeroMedia(
  item: RankedFeedCandidate,
  menuItem?: FeedMenuItemSummary | null,
): FeedMediaSummary | null {
  if (menuItem) {
    if (!isValidKoboAmount(menuItem.priceKobo) || menuItem.priceKobo < 0) return null
    if (menuItem.imageUrl) {
      return {
        id: `${item.id}:menu-item`,
        kind: 'image',
        publicUrl: menuItem.imageUrl,
        altText: menuItem.name,
        caption: menuItem.name,
      }
    }
    return null
  }
  return item.media?.[0] ?? null
}

export function isValidOldPrice(currentKobo: number, oldKobo: number | null | undefined): oldKobo is number {
  return typeof oldKobo === 'number' && Number.isFinite(oldKobo) && oldKobo > currentKobo && oldKobo > 0
}

export function formatDiscountLabel(currentKobo: number, oldKobo: number | null | undefined): string | null {
  if (!isValidOldPrice(currentKobo, oldKobo)) return null
  const savings = oldKobo - currentKobo
  const percent = Math.round((savings / oldKobo) * 100)
  if (percent <= 0 || percent >= 100) return null
  return `${percent}% OFF`
}
