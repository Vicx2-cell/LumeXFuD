import { formatPrice, isValidKoboAmount } from '@/lib/money'

export const FEED_AUTOMATION_TEMPLATE_VERSION = '2026-07-29.v1'

export type VendorAutomaticPostType =
  | 'vendor_welcome'
  | 'new_menu_item'
  | 'item_back_in_stock'
  | 'price_drop'
  | 'new_bundle'
  | 'popular_item'
  | 'vendor_reopened'
  | 'order_milestone'

export type OfficialAutomaticPostType =
  | 'cheap_eats'
  | 'breakfast_collection'
  | 'lunch_collection'
  | 'evening_collection'
  | 'late_night_collection'
  | 'new_on_lumex'
  | 'popular_near_you'
  | 'back_in_stock'
  | 'lumex_picks'
  | 'order_activity_collection'

export type AutomaticPostType = VendorAutomaticPostType | OfficialAutomaticPostType

export interface FeedAutomationConfig {
  enabled: boolean
  vendorDailyLimit: number
  officialAreaWindowLimit: number
  duplicateTopicCooldownHours: number
  menuBatchWindowMinutes: number
  vendorReopenMinimumHours: number
  priceDropMinimumBps: number
  priceDropMinimumKobo: number
  backInStockMinimumOrders: number
  popularityMinimumOrders: number
  anonymityMinimumOrders: number
  orderAggregationHours: number
  affordabilityMaxItemKobo: number
  affordabilityMaxMealKobo: number
  collectionItemCount: number
  enabledPostTypes: ReadonlySet<AutomaticPostType>
  milestoneValues: readonly number[]
}

export const DEFAULT_FEED_AUTOMATION_CONFIG: FeedAutomationConfig = {
  enabled: false,
  vendorDailyLimit: 2,
  officialAreaWindowLimit: 1,
  duplicateTopicCooldownHours: 72,
  menuBatchWindowMinutes: 30,
  vendorReopenMinimumHours: 48,
  priceDropMinimumBps: 1_000,
  priceDropMinimumKobo: 50_000,
  backInStockMinimumOrders: 2,
  popularityMinimumOrders: 10,
  anonymityMinimumOrders: 5,
  orderAggregationHours: 6,
  affordabilityMaxItemKobo: 200_000,
  affordabilityMaxMealKobo: 200_000,
  collectionItemCount: 5,
  enabledPostTypes: new Set<AutomaticPostType>([
    'vendor_welcome', 'new_menu_item', 'item_back_in_stock', 'price_drop',
    'new_bundle', 'popular_item', 'vendor_reopened', 'order_milestone',
    'cheap_eats', 'breakfast_collection', 'lunch_collection',
    'evening_collection', 'late_night_collection', 'new_on_lumex',
    'popular_near_you', 'back_in_stock', 'lumex_picks',
    'order_activity_collection',
  ]),
  milestoneValues: [25, 50, 100, 500],
}

export interface VendorPostFacts {
  vendorId: string
  vendorName: string
  vendorApproved: boolean
  vendorActive: boolean
  storefrontComplete: boolean
  automationPaused?: boolean
  optionalMarketingEnabled?: boolean
  availableMenuItemCount: number
  itemId?: string | null
  itemName?: string | null
  itemPriceKobo?: number | null
  itemAvailable?: boolean
  itemImageUrl?: string | null
  bundleId?: string | null
  bundleName?: string | null
  bundlePriceKobo?: number | null
  bundleActive?: boolean
  bundlePrimaryMenuItemId?: string | null
  previousPriceKobo?: number | null
  verifiedItemOrders?: number
  completedVendorOrders?: number
  milestone?: number
  vendorClosedHours?: number | null
}

export interface Eligibility {
  eligible: boolean
  reason: string
}

function validText(value: string | null | undefined) {
  return Boolean(value?.trim())
}

export function isVendorPostEligible(
  type: VendorAutomaticPostType,
  facts: VendorPostFacts,
  config: FeedAutomationConfig,
): Eligibility {
  if (!config.enabled) return { eligible: false, reason: 'automation kill switch is off' }
  if (!config.enabledPostTypes.has(type)) return { eligible: false, reason: 'post type is disabled' }
  if (facts.automationPaused) return { eligible: false, reason: 'vendor automation is paused' }
  if (facts.optionalMarketingEnabled === false) return { eligible: false, reason: 'vendor opted out of optional marketing' }
  if (!facts.vendorApproved || !facts.vendorActive) return { eligible: false, reason: 'vendor is not approved and active' }
  if (!facts.storefrontComplete) return { eligible: false, reason: 'storefront is incomplete' }
  if (facts.availableMenuItemCount < 1) return { eligible: false, reason: 'no available menu item' }

  if (type === 'vendor_welcome') return { eligible: true, reason: 'approved storefront has an available menu' }
  if (type === 'vendor_reopened') {
    return (facts.vendorClosedHours ?? 0) >= config.vendorReopenMinimumHours
      ? { eligible: true, reason: 'vendor reopened after a meaningful closure' }
      : { eligible: false, reason: 'closure was too short for a reopening post' }
  }
  if (type === 'order_milestone') {
    return facts.milestone && facts.completedVendorOrders === facts.milestone
      ? { eligible: true, reason: `verified completed-order milestone ${facts.milestone}` }
      : { eligible: false, reason: 'no new configured milestone' }
  }
  if (type === 'new_bundle') {
    if (!facts.bundleId || !validText(facts.bundleName) || facts.bundleActive !== true) {
      return { eligible: false, reason: 'linked bundle is missing or inactive' }
    }
    if (!facts.bundlePrimaryMenuItemId || !isValidKoboAmount(facts.bundlePriceKobo)) {
      return { eligible: false, reason: 'bundle has no orderable primary item or valid price' }
    }
    return { eligible: true, reason: 'new active bundle has a real price and orderable contents' }
  }
  if (!facts.itemId || !validText(facts.itemName) || facts.itemAvailable !== true) {
    return { eligible: false, reason: 'linked menu item is missing or unavailable' }
  }
  if (!isValidKoboAmount(facts.itemPriceKobo) || Number(facts.itemPriceKobo) < 0) {
    return { eligible: false, reason: 'linked menu item price is invalid' }
  }
  if (type === 'item_back_in_stock' && (facts.verifiedItemOrders ?? 0) < config.backInStockMinimumOrders) {
    return { eligible: false, reason: 'item has insufficient verified order history' }
  }
  if (type === 'popular_item' && (facts.verifiedItemOrders ?? 0) < config.popularityMinimumOrders) {
    return { eligible: false, reason: 'real order threshold not reached' }
  }
  if (type === 'price_drop') {
    const oldPrice = facts.previousPriceKobo
    const newPrice = facts.itemPriceKobo
    if (!isValidKoboAmount(oldPrice) || !isValidKoboAmount(newPrice) || oldPrice <= newPrice) {
      return { eligible: false, reason: 'not a real price reduction' }
    }
    const drop = oldPrice - newPrice
    const bps = Math.floor((drop * 10_000) / oldPrice)
    if (drop < config.priceDropMinimumKobo && bps < config.priceDropMinimumBps) {
      return { eligible: false, reason: 'price reduction is below configured thresholds' }
    }
  }
  return { eligible: true, reason: 'source facts meet publishing rules' }
}

export function renderVendorAutomaticPost(type: VendorAutomaticPostType, facts: VendorPostFacts): string {
  const vendor = facts.vendorName.trim()
  const item = (type === 'new_bundle' ? facts.bundleName : facts.itemName)?.trim() ?? ''
  const rawPrice = type === 'new_bundle' ? facts.bundlePriceKobo : facts.itemPriceKobo
  const price = isValidKoboAmount(rawPrice) ? formatPrice(rawPrice) : null
  switch (type) {
    case 'vendor_welcome':
      return `Now serving on LumeX Fud 🍽️\nExplore ${vendor} and order directly from the menu.`
    case 'new_menu_item':
      return `Fresh on the menu at ${vendor}: ${item}${price ? ` for ${price}` : ''}. View the menu and order.`
    case 'item_back_in_stock':
      return `${item} is available again at ${vendor}. Check the live menu before ordering.`
    case 'price_drop':
      return `${item} at ${vendor} is now ${price}. View the current menu price and order.`
    case 'new_bundle':
      return `A new bundle is available at ${vendor}: ${item}${price ? ` for ${price}` : ''}. View what is included.`
    case 'popular_item':
      return `One of the most ordered at ${vendor}: ${item}. Based on verified paid and completed orders.`
    case 'vendor_reopened':
      return `${vendor} is accepting orders again. Explore the currently available menu.`
    case 'order_milestone':
      return `${vendor} has completed ${facts.milestone} orders on LumeX Fud. Explore the available menu.`
  }
}

export interface AffordableItem {
  id: string
  vendorId: string
  vendorName: string
  name: string
  priceKobo: number | null | undefined
  requiredAddons: ReadonlyArray<{ priceKobo: number; available: boolean }>
  available: boolean
  vendorApproved: boolean
  vendorActive: boolean
  vendorOpen: boolean
  inDeliveryCoverage: boolean
  areaId: string
}

export function minimumOrderablePriceKobo(item: AffordableItem): number | null {
  if (!isValidKoboAmount(item.priceKobo)) return null
  let total = item.priceKobo
  for (const addon of item.requiredAddons) {
    if (!addon.available || !isValidKoboAmount(addon.priceKobo)) return null
    total += addon.priceKobo
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

export function selectAffordableItems(
  items: readonly AffordableItem[],
  config: Pick<FeedAutomationConfig, 'affordabilityMaxItemKobo' | 'affordabilityMaxMealKobo' | 'collectionItemCount'>,
  areaId: string,
): Array<AffordableItem & { minimumOrderablePriceKobo: number }> {
  const perVendor = new Set<string>()
  const result: Array<AffordableItem & { minimumOrderablePriceKobo: number }> = []
  for (const item of [...items].sort((a, b) => (minimumOrderablePriceKobo(a) ?? Infinity) - (minimumOrderablePriceKobo(b) ?? Infinity))) {
    const actualMinimum = minimumOrderablePriceKobo(item)
    if (
      item.areaId !== areaId || !item.available || !item.vendorApproved ||
      !item.vendorActive || !item.vendorOpen || !item.inDeliveryCoverage ||
      actualMinimum === null || item.priceKobo! > config.affordabilityMaxItemKobo ||
      actualMinimum > config.affordabilityMaxMealKobo || perVendor.has(item.vendorId)
    ) continue
    result.push({ ...item, minimumOrderablePriceKobo: actualMinimum })
    perVendor.add(item.vendorId)
    if (result.length >= config.collectionItemCount) break
  }
  return result
}

export interface AggregatedOrder {
  orderId: string
  vendorId: string
  itemId: string
  areaId: string
  status: string
  paymentStatus: string
  isTest: boolean
  fraudFlagged: boolean
  refunded: boolean
  customerId?: string | null
}

export interface OrderActivity {
  areaId: string
  itemId: string
  vendorId: string
  validOrderCount: number
}

export function aggregatePrivateOrderActivity(
  orders: readonly AggregatedOrder[],
  minimumAnonymousOrders: number,
): OrderActivity[] {
  const counts = new Map<string, OrderActivity>()
  for (const order of orders) {
    if (
      order.paymentStatus !== 'PAID' || !['DELIVERED', 'COMPLETED'].includes(order.status) ||
      order.isTest || order.fraudFlagged || order.refunded
    ) continue
    const key = `${order.areaId}:${order.vendorId}:${order.itemId}`
    const row = counts.get(key) ?? {
      areaId: order.areaId, itemId: order.itemId, vendorId: order.vendorId, validOrderCount: 0,
    }
    row.validOrderCount += 1
    counts.set(key, row)
  }
  return [...counts.values()]
    .filter((row) => row.validOrderCount >= minimumAnonymousOrders)
    .sort((a, b) => b.validOrderCount - a.validOrderCount || a.vendorId.localeCompare(b.vendorId))
}

export function renderOfficialCollection(
  type: OfficialAutomaticPostType,
  areaLabel: string,
  itemCount: number,
  maximumPriceKobo?: number,
): string {
  if (type === 'cheap_eats') {
    return `Affordable picks around ${areaLabel} 🍲\nExplore ${itemCount} available meals${maximumPriceKobo ? ` under ${formatPrice(maximumPriceKobo)}` : ''}.`
  }
  const labels: Record<Exclude<OfficialAutomaticPostType, 'cheap_eats'>, string> = {
    breakfast_collection: 'Breakfast available now',
    lunch_collection: 'Lunch options available now',
    evening_collection: 'Evening food picks',
    late_night_collection: 'Open for late-night orders',
    new_on_lumex: 'New on LumeX Fud',
    popular_near_you: 'Popular near you from verified orders',
    back_in_stock: 'Back on available menus',
    lumex_picks: 'LumeX picks based on published eligibility rules',
    order_activity_collection: 'Popular from aggregated marketplace activity',
  }
  return `${labels[type]} around ${areaLabel}. Explore ${itemCount} currently available options.`
}

export function automaticPostIdempotencyKey(
  type: AutomaticPostType,
  sourceEntityId: string,
  discriminator = 'once',
): string {
  return `feed-auto:${FEED_AUTOMATION_TEMPLATE_VERSION}:${type}:${sourceEntityId}:${discriminator}`
}

export function findReachedMilestone(count: number, milestones: readonly number[]): number | null {
  return milestones.includes(count) ? count : null
}

export interface FeedFallbackCard {
  kind: 'vendors_nearby' | 'affordable_meals' | 'recent_menu_items' | 'open_vendors' | 'categories' | 'browse_all'
  title: string
  href: string
  entityIds: string[]
}

export function buildEmptyFeedFallback(input: {
  nearbyVendorIds: string[]
  affordableItemIds: string[]
  recentItemIds: string[]
  openVendorIds: string[]
  categories: string[]
}): FeedFallbackCard[] {
  const cards: FeedFallbackCard[] = []
  if (input.nearbyVendorIds.length) cards.push({ kind: 'vendors_nearby', title: 'Available vendors nearby', href: '/home', entityIds: input.nearbyVendorIds.slice(0, 6) })
  if (input.affordableItemIds.length) cards.push({ kind: 'affordable_meals', title: 'Affordable meals available now', href: '/home?sort=price_asc', entityIds: input.affordableItemIds.slice(0, 6) })
  if (input.recentItemIds.length) cards.push({ kind: 'recent_menu_items', title: 'Recently added to menus', href: '/home?sort=newest', entityIds: input.recentItemIds.slice(0, 6) })
  if (input.openVendorIds.length) cards.push({ kind: 'open_vendors', title: 'Open and accepting orders', href: '/home?open=true', entityIds: input.openVendorIds.slice(0, 6) })
  if (input.categories.length) cards.push({ kind: 'categories', title: 'Explore food categories', href: '/home', entityIds: input.categories.slice(0, 8) })
  cards.push({ kind: 'browse_all', title: 'Browse all vendors', href: '/home', entityIds: [] })
  return cards
}

export interface FeedPin {
  postId: string
  scopeType: 'global' | 'city' | 'campus' | 'delivery_area'
  scopeId: string | null
  startsAt: string
  expiresAt: string | null
  priority: number
  unpinnedAt?: string | null
}

export function canManageOfficialPins(role: string, isOfficialPost: boolean): boolean {
  return role === 'super_admin' && isOfficialPost
}

export function isPinActive(pin: FeedPin, now = new Date()): boolean {
  const start = new Date(pin.startsAt).getTime()
  const expiry = pin.expiresAt ? new Date(pin.expiresAt).getTime() : Infinity
  return !pin.unpinnedAt && Number.isFinite(start) && start <= now.getTime() && expiry > now.getTime()
}

export function pinMatchesViewer(
  pin: FeedPin,
  viewer: { cityId?: string | null; campusId?: string | null; deliveryAreaId?: string | null },
): boolean {
  if (pin.scopeType === 'global') return pin.scopeId === null
  if (pin.scopeType === 'city') return pin.scopeId === viewer.cityId
  if (pin.scopeType === 'campus') return pin.scopeId === viewer.campusId
  return pin.scopeId === viewer.deliveryAreaId
}

export function rotateVendorsFairly<T extends { vendorId: string }>(items: readonly T[], limit: number): T[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) buckets.set(item.vendorId, [...(buckets.get(item.vendorId) ?? []), item])
  const result: T[] = []
  while (result.length < limit && [...buckets.values()].some((bucket) => bucket.length)) {
    for (const bucket of buckets.values()) {
      const next = bucket.shift()
      if (next) result.push(next)
      if (result.length >= limit) break
    }
  }
  return result
}
