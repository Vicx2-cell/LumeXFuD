import crypto from 'node:crypto'
import { formatPrice, isValidKoboAmount } from '@/lib/money'

export type OfficialAreaScope = 'city' | 'zone'
export type OfficialCollectionType =
  | 'new_on_lumex'
  | 'lumex_picks'
  | 'morning_collection'
  | 'evening_collection'
  | 'breakfast_picks'
  | 'lunch_picks'
  | 'dinner_picks'
  | 'student_budget'
  | 'open_right_now'
  | 'closing_soon'
  | 'rice_lovers'
  | 'shawarma_picks'
  | 'pizza_friday'
  | 'drinks_around_you'
  | 'fast_delivery_picks'
  | 'new_vendors'
  | 'new_menus_week'
  | 'active_deals'
  | 'sponsored'
  | 'event'

export interface OfficialAreaConfig {
  id: string
  areaScope: OfficialAreaScope
  areaId: string
  areaLabel: string
  morningEnabled: boolean
  eveningEnabled: boolean
  autoPublish: boolean
  morningCron?: string
  eveningCron?: string
  lateNightStart: string
  minPopularityOrders: number
  priceThresholdKobo: number
  maxPostsPerDay: number
  maxCollectionItems: number
  picksMaxPerDay: number
}

export interface OfficialSourceItem {
  id: string
  vendorId: string
  vendorName: string
  vendorHandle?: string | null
  vendorCreatedAt?: string | null
  itemName: string
  priceKobo: number
  imageUrl: string | null
  imageBelongsToItem: boolean
  isAvailable: boolean
  vendorApproved: boolean
  vendorActive: boolean
  vendorVisible: boolean
  servesArea: boolean
  areaScope: OfficialAreaScope
  areaId: string
  publishedAt?: string | null
  createdAt?: string | null
  category?: string | null
  popularityOrders30d?: number
  totalRatings?: number
  avgRating?: number
  dealEndsAt?: string | null
  dealActive?: boolean
  openingTime?: string | null
  closingTime?: string | null
  sourceType: 'vendor' | 'menu_item' | 'deal'
  sourceId: string
}

export interface OfficialDisplayItem {
  vendorId: string
  vendorName: string
  itemName: string
  priceKobo: number
  priceLabel: string
  imageUrl: string | null
  availabilityLabel: string
  menuItemId: string
  sourceType: OfficialSourceItem['sourceType']
}

export interface OfficialCollectionPlan {
  title: string
  subtitle: string
  collectionType: OfficialCollectionType
  generationReason: string
  sourceType: string
  sourceId: string
  areaScope: OfficialAreaScope
  areaId: string
  selectionMetadata: Record<string, unknown>
  dedupeKey: string
  contentHash: string
  items: OfficialDisplayItem[]
}

export interface OfficialCollectionHistoryRow {
  vendorId: string
  sourceId: string
  areaId: string
  collectionType: OfficialCollectionType
  createdAt: string
}

export interface OfficialCollectionRules {
  minItems: number
  maxItems: number
  maxPerVendor: number
  priceThresholdKobo: number
  minPopularityOrders: number
  lateNightStart: string
  now: Date
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function formatOfficialMoney(kobo: number): string {
  return isValidKoboAmount(kobo) && kobo >= 0 ? formatPrice(kobo) : 'Available near you'
}

export function isSupportedPopularityClaim(input: Pick<OfficialSourceItem, 'popularityOrders30d' | 'totalRatings' | 'avgRating'>, threshold: number): boolean {
  const orderCount = Number(input.popularityOrders30d ?? 0)
  const ratingCount = Number(input.totalRatings ?? 0)
  const rating = Number(input.avgRating ?? 0)
  return orderCount >= threshold || (ratingCount >= threshold && rating >= 4)
}

export function isLateNight(now: Date, lateNightStart: string): boolean {
  const [hourStr, minuteStr] = lateNightStart.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr ?? 0)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const current = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now)
  const [currentHourStr, currentMinuteStr] = current.split(':')
  const currentMinutes = (Number(currentHourStr) * 60) + Number(currentMinuteStr)
  const startMinutes = (hour * 60) + minute
  if (!Number.isFinite(currentMinutes)) return false
  if (currentMinutes >= startMinutes) return true
  return currentMinutes < 6 * 60
}

function computeScore(item: OfficialSourceItem, history: Map<string, number>): number {
  const repeatPenalty = history.get(item.vendorId) ?? 0
  const popularity = Math.max(0, Number(item.popularityOrders30d ?? 0))
  const rating = Math.max(0, Number(item.avgRating ?? 0))
  const recency = item.publishedAt ? Math.max(0, 1000 - (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000) : 0
  const priceSignal = item.priceKobo <= 300_000 ? 2 : item.priceKobo <= 500_000 ? 1 : 0
  return (popularity * 2) + (rating * 3) + priceSignal + (recency / 100) - (repeatPenalty * 3)
}

function isWithinHours(now: Date, openingTime?: string | null, closingTime?: string | null): boolean {
  if (!openingTime || !closingTime) return true
  const current = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now)
  if (openingTime <= closingTime) {
    return current >= openingTime && current < closingTime
  }
  return current >= openingTime || current < closingTime
}

export function selectFairOfficialItems(
  items: OfficialSourceItem[],
  rules: OfficialCollectionRules,
  history: OfficialCollectionHistoryRow[] = [],
): { items: OfficialSourceItem[]; skippedReasons: Record<string, string> } {
  const skippedReasons: Record<string, string> = {}
  const vendorCounts = new Map<string, number>()
  for (const row of history) {
    vendorCounts.set(row.vendorId, (vendorCounts.get(row.vendorId) ?? 0) + 1)
  }

  const filtered = items.filter((item) => {
    if (!item.vendorApproved || !item.vendorActive || !item.vendorVisible) {
      skippedReasons[item.id] = 'vendor not approved/active/visible'
      return false
    }
    if (!item.servesArea) {
      skippedReasons[item.id] = 'outside area'
      return false
    }
    if (!item.isAvailable) {
      skippedReasons[item.id] = 'unavailable'
      return false
    }
    if (!item.imageBelongsToItem || !item.imageUrl) {
      skippedReasons[item.id] = 'missing verified image'
      return false
    }
    if (!isValidKoboAmount(item.priceKobo) || item.priceKobo < 0) {
      skippedReasons[item.id] = 'invalid price'
      return false
    }
    if (item.sourceType === 'deal' && item.dealActive === false) {
      skippedReasons[item.id] = 'inactive deal'
      return false
    }
    if (item.sourceType === 'deal' && item.dealEndsAt && new Date(item.dealEndsAt).getTime() <= Date.now()) {
      skippedReasons[item.id] = 'expired deal'
      return false
    }
    if (!isWithinHours(rules.now, item.openingTime, item.closingTime)) {
      skippedReasons[item.id] = 'outside opening hours'
      return false
    }
    return true
  })

  const scored = filtered
    .map((item) => ({ item, score: computeScore(item, vendorCounts) }))
    .sort((a, b) => b.score - a.score || a.item.vendorName.localeCompare(b.item.vendorName) || a.item.itemName.localeCompare(b.item.itemName))

  const picked: OfficialSourceItem[] = []
  const pickedPerVendor = new Map<string, number>()
  for (const row of scored) {
    const count = pickedPerVendor.get(row.item.vendorId) ?? 0
    if (count >= rules.maxPerVendor) continue
    picked.push(row.item)
    pickedPerVendor.set(row.item.vendorId, count + 1)
    if (picked.length >= rules.maxItems) break
  }

  return { items: picked, skippedReasons }
}

export function buildOfficialCollectionPlan(input: {
  collectionType: OfficialCollectionType
  area: OfficialAreaConfig
  source: OfficialSourceItem[]
  history?: OfficialCollectionHistoryRow[]
  now?: Date
  forcedTitle?: string
  forcedSubtitle?: string
  sourceType?: string
  sourceId?: string
  generationReason: string
}): OfficialCollectionPlan | null {
  const now = input.now ?? new Date()
  const rules: OfficialCollectionRules = {
    minItems: [
      'new_on_lumex',
      'new_vendors',
      'new_menus_week',
      'active_deals',
      'open_right_now',
      'closing_soon',
      'student_budget',
      'fast_delivery_picks',
      'breakfast_picks',
      'lunch_picks',
      'dinner_picks',
      'rice_lovers',
      'shawarma_picks',
      'pizza_friday',
      'drinks_around_you',
    ].includes(input.collectionType)
      ? 2
      : 3,
    maxItems: input.area.maxCollectionItems,
    maxPerVendor: 2,
    priceThresholdKobo: input.area.priceThresholdKobo,
    minPopularityOrders: input.area.minPopularityOrders,
    lateNightStart: input.area.lateNightStart,
    now,
  }

  const filteredSource = input.source.filter(() => {
    if (input.collectionType === 'evening_collection') return isLateNight(now, rules.lateNightStart) ? true : false
    return true
  })

  const selection = selectFairOfficialItems(filteredSource, rules, input.history ?? [])
  if (selection.items.length < rules.minItems && input.collectionType !== 'new_on_lumex') return null
  if (selection.items.length === 0) return null

  const title = input.forcedTitle ?? (
    input.collectionType === 'morning_collection'
      ? `Good morning ${input.area.areaLabel} ☀️`
    : input.collectionType === 'evening_collection'
      ? 'Late Night Eats 🌙'
    : input.collectionType === 'breakfast_picks'
      ? 'Breakfast Picks'
    : input.collectionType === 'lunch_picks'
      ? 'Lunch Picks'
    : input.collectionType === 'dinner_picks'
      ? 'Dinner Picks'
    : input.collectionType === 'student_budget'
      ? 'Student Budget Meals'
    : input.collectionType === 'open_right_now'
      ? 'Open Right Now'
    : input.collectionType === 'closing_soon'
      ? 'Closing Soon'
    : input.collectionType === 'rice_lovers'
      ? 'Rice Lovers'
    : input.collectionType === 'shawarma_picks'
      ? 'Shawarma Picks'
    : input.collectionType === 'pizza_friday'
      ? 'Pizza Friday'
    : input.collectionType === 'drinks_around_you'
      ? 'Drinks Around You'
    : input.collectionType === 'fast_delivery_picks'
      ? 'Fast-Delivery Picks'
    : input.collectionType === 'new_vendors'
      ? 'New Vendors'
    : input.collectionType === 'new_menus_week'
      ? 'New Menus This Week'
    : input.collectionType === 'active_deals'
      ? 'Active Deals'
      : input.collectionType === 'new_on_lumex'
        ? 'New on LumeX'
        : input.collectionType === 'lumex_picks'
          ? (() => {
                const claimSource = selection.items.find((item) => isSupportedPopularityClaim(item, rules.minPopularityOrders))
                if (!claimSource) return 'LumeX Picks'
                const price = formatOfficialMoney(claimSource.priceKobo)
                const itemLabel = claimSource.category?.trim() || claimSource.itemName
                return `Best ${itemLabel} under ${price}`
              })()
            : 'Promoted by LumeX'
  )

  const subtitle = input.forcedSubtitle ?? (
    input.collectionType === 'morning_collection'
      ? 'Breakfast, lunch, dinner, and live deals near you'
    : input.collectionType === 'evening_collection'
      ? `Only vendors and meals still available after ${rules.lateNightStart}`
    : input.collectionType === 'breakfast_picks'
      ? 'Compact breakfast ideas from real live menus'
    : input.collectionType === 'lunch_picks'
      ? 'Midday meals that are actually available now'
    : input.collectionType === 'dinner_picks'
      ? 'Evening meals from nearby vendors'
    : input.collectionType === 'student_budget'
      ? 'Meals under the configured price cap'
    : input.collectionType === 'open_right_now'
      ? 'Vendors with live availability right now'
    : input.collectionType === 'closing_soon'
      ? 'Meals that are running low on service time'
    : input.collectionType === 'rice_lovers'
      ? 'Rice meals pulled from verified live menus'
    : input.collectionType === 'shawarma_picks'
      ? 'Shawarma around you, without the fluff'
    : input.collectionType === 'pizza_friday'
      ? 'Friday pizza picks from live vendors'
    : input.collectionType === 'drinks_around_you'
      ? 'Drinks and sides from nearby vendors'
    : input.collectionType === 'fast_delivery_picks'
      ? 'Good bets when speed matters'
    : input.collectionType === 'new_vendors'
      ? 'Recently approved vendors and first menus'
    : input.collectionType === 'new_menus_week'
      ? 'New menu items added this week'
    : input.collectionType === 'active_deals'
      ? 'Live discounts and deal-linked items'
    : input.collectionType === 'new_on_lumex'
      ? 'Recently approved vendors, new menu items, and live deals'
      : input.collectionType === 'lumex_picks'
        ? 'Curated from verified live platform data'
        : 'Clearly labelled sponsored placements'
  )

  const items = selection.items.slice(0, rules.maxItems).map((item) => ({
    vendorId: item.vendorId,
    vendorName: item.vendorName,
    itemName: item.itemName,
    priceKobo: item.priceKobo,
    priceLabel: formatOfficialMoney(item.priceKobo),
    imageUrl: item.imageUrl,
    availabilityLabel: item.isAvailable ? 'Available now' : 'Unavailable',
    menuItemId: item.id,
    sourceType: item.sourceType,
  }))

  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      collectionType: input.collectionType,
      areaScope: input.area.areaScope,
      areaId: input.area.areaId,
      title,
      subtitle,
      items: items.map((item) => item.menuItemId),
    }))
    .digest('hex')

  const dedupeKey = `${input.collectionType}:${input.area.areaScope}:${input.area.areaId}:${slugify(title)}:${contentHash.slice(0, 16)}`
  const sourceType = input.sourceType ?? input.collectionType
  const sourceId = input.sourceId ?? (input.source[0]?.sourceId ?? contentHash.slice(0, 24))

  return {
    title,
    subtitle,
    collectionType: input.collectionType,
    generationReason: input.generationReason,
    sourceType,
    sourceId,
    areaScope: input.area.areaScope,
    areaId: input.area.areaId,
    selectionMetadata: {
      pickedVendorIds: Array.from(new Set(items.map((item) => item.vendorId))),
      pickedMenuItemIds: items.map((item) => item.menuItemId),
      skippedReasons: selection.skippedReasons,
      maxPerVendor: rules.maxPerVendor,
      lateNightStart: rules.lateNightStart,
      minPopularityOrders: rules.minPopularityOrders,
      priceThresholdKobo: rules.priceThresholdKobo,
    },
    dedupeKey,
    contentHash,
    items,
  }
}

export function collectionIsPromotable(plan: OfficialCollectionPlan | null): plan is OfficialCollectionPlan {
  return Boolean(plan && plan.items.length > 0)
}
