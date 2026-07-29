import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEED_AUTOMATION_CONFIG,
  aggregatePrivateOrderActivity,
  automaticPostIdempotencyKey,
  buildEmptyFeedFallback,
  canManageOfficialPins,
  findReachedMilestone,
  isPinActive,
  isVendorPostEligible,
  minimumOrderablePriceKobo,
  pinMatchesViewer,
  renderOfficialCollection,
  renderVendorAutomaticPost,
  rotateVendorsFairly,
  selectAffordableItems,
  type AffordableItem,
  type VendorPostFacts,
} from './automation'

const enabledConfig = { ...DEFAULT_FEED_AUTOMATION_CONFIG, enabled: true }
const vendor: VendorPostFacts = {
  vendorId: 'vendor-1',
  vendorName: 'Mama Chika’s Kitchen',
  vendorApproved: true,
  vendorActive: true,
  storefrontComplete: true,
  availableMenuItemCount: 1,
  itemId: 'item-1',
  itemName: 'Chicken Fried Rice',
  itemPriceKobo: 250_000,
  itemAvailable: true,
  itemImageUrl: '/rice.jpg',
  verifiedItemOrders: 12,
}

describe('vendor automatic feed eligibility', () => {
  it('publishes welcome only for an approved complete storefront with an available menu', () => {
    expect(isVendorPostEligible('vendor_welcome', vendor, enabledConfig).eligible).toBe(true)
    expect(isVendorPostEligible('vendor_welcome', { ...vendor, vendorApproved: false }, enabledConfig).eligible).toBe(false)
    expect(isVendorPostEligible('vendor_welcome', { ...vendor, storefrontComplete: false }, enabledConfig).eligible).toBe(false)
    expect(isVendorPostEligible('vendor_welcome', { ...vendor, availableMenuItemCount: 0 }, enabledConfig).eligible).toBe(false)
  })

  it('honors the kill switch and per-vendor marketing opt-out', () => {
    expect(isVendorPostEligible('new_menu_item', vendor, DEFAULT_FEED_AUTOMATION_CONFIG).reason).toContain('kill switch')
    expect(isVendorPostEligible('new_menu_item', { ...vendor, optionalMarketingEnabled: false }, enabledConfig).eligible).toBe(false)
    expect(isVendorPostEligible('new_menu_item', { ...vendor, automationPaused: true }, enabledConfig).eligible).toBe(false)
  })

  it('requires meaningful real order history for stock and popularity claims', () => {
    expect(isVendorPostEligible('item_back_in_stock', { ...vendor, verifiedItemOrders: 0 }, enabledConfig).eligible).toBe(false)
    expect(isVendorPostEligible('popular_item', { ...vendor, verifiedItemOrders: 9 }, enabledConfig).eligible).toBe(false)
    expect(isVendorPostEligible('popular_item', vendor, enabledConfig).eligible).toBe(true)
  })

  it('accepts only real, meaningful price reductions', () => {
    expect(isVendorPostEligible('price_drop', { ...vendor, previousPriceKobo: 300_000 }, enabledConfig).eligible).toBe(true)
    expect(isVendorPostEligible('price_drop', { ...vendor, previousPriceKobo: 250_000 }, enabledConfig).eligible).toBe(false)
    expect(isVendorPostEligible('price_drop', { ...vendor, previousPriceKobo: 255_000 }, enabledConfig).eligible).toBe(false)
  })

  it('publishes a bundle only when it has a real price and orderable primary item', () => {
    const bundle = {
      ...vendor,
      bundleId: 'bundle-1',
      bundleName: 'Rice and Chicken Combo',
      bundlePriceKobo: 300_000,
      bundleActive: true,
      bundlePrimaryMenuItemId: 'item-1',
    }
    expect(isVendorPostEligible('new_bundle', bundle, enabledConfig).eligible).toBe(true)
    expect(isVendorPostEligible('new_bundle', { ...bundle, bundleActive: false }, enabledConfig).eligible).toBe(false)
    expect(renderVendorAutomaticPost('new_bundle', bundle)).toContain('Rice and Chicken Combo')
  })

  it('uses deterministic non-impersonating templates and stable idempotency keys', () => {
    expect(renderVendorAutomaticPost('new_menu_item', vendor)).toBe(
      'Fresh on the menu at Mama Chika’s Kitchen: Chicken Fried Rice for ₦2,500. View the menu and order.',
    )
    expect(automaticPostIdempotencyKey('vendor_welcome', 'vendor-1')).toBe(
      automaticPostIdempotencyKey('vendor_welcome', 'vendor-1'),
    )
    expect(new Set([
      automaticPostIdempotencyKey('order_milestone', 'vendor-1', '25'),
      automaticPostIdempotencyKey('order_milestone', 'vendor-1', '50'),
    ]).size).toBe(2)
  })

  it('publishes a configured milestone at most at the exact crossing count', () => {
    expect(findReachedMilestone(25, [25, 50, 100])).toBe(25)
    expect(findReachedMilestone(26, [25, 50, 100])).toBeNull()
  })
})

describe('affordable official collections', () => {
  const base: AffordableItem = {
    id: 'item-1', vendorId: 'vendor-1', vendorName: 'Vendor 1', name: 'Rice',
    priceKobo: 180_000, requiredAddons: [], available: true, vendorApproved: true,
    vendorActive: true, vendorOpen: true, inDeliveryCoverage: true, areaId: 'uturu',
  }

  it('includes mandatory add-ons in the advertised minimum meal price', () => {
    const item = { ...base, requiredAddons: [{ priceKobo: 30_000, available: true }] }
    expect(minimumOrderablePriceKobo(item)).toBe(210_000)
    expect(selectAffordableItems([item], enabledConfig, 'uturu')).toEqual([])
  })

  it('excludes unavailable, closed, incomplete-price, and out-of-coverage choices', () => {
    const choices = [
      { ...base, id: 'unavailable', available: false },
      { ...base, id: 'closed', vendorOpen: false },
      { ...base, id: 'bad-price', priceKobo: undefined },
      { ...base, id: 'outside', inDeliveryCoverage: false },
    ]
    expect(selectAffordableItems(choices, enabledConfig, 'uturu')).toEqual([])
  })

  it('rotates vendors and uses the actual orderable threshold in copy', () => {
    const choices = [
      base,
      { ...base, id: 'same-vendor', name: 'Beans' },
      { ...base, id: 'other', vendorId: 'vendor-2', vendorName: 'Vendor 2' },
    ]
    expect(selectAffordableItems(choices, enabledConfig, 'uturu').map((item) => item.vendorId)).toEqual(['vendor-1', 'vendor-2'])
    expect(renderOfficialCollection('cheap_eats', 'Uturu', 5, 200_000)).toContain('under ₦2,000')
  })
})

describe('private order-derived discovery', () => {
  const valid = {
    vendorId: 'vendor-1', itemId: 'item-1', areaId: 'uturu',
    status: 'COMPLETED', paymentStatus: 'PAID', isTest: false,
    fraudFlagged: false, refunded: false, customerId: 'private-customer',
  }

  it('requires an anonymity threshold and emits no customer identity', () => {
    const orders = Array.from({ length: 5 }, (_, index) => ({ ...valid, orderId: `order-${index}` }))
    const activity = aggregatePrivateOrderActivity(orders, 5)
    expect(activity).toEqual([{ areaId: 'uturu', itemId: 'item-1', vendorId: 'vendor-1', validOrderCount: 5 }])
    expect(JSON.stringify(activity)).not.toContain('private-customer')
    expect(aggregatePrivateOrderActivity(orders.slice(0, 4), 5)).toEqual([])
  })

  it('excludes refunded, test, fraud-flagged, cancelled, and unpaid orders', () => {
    const excluded = [
      { ...valid, orderId: '1', refunded: true },
      { ...valid, orderId: '2', isTest: true },
      { ...valid, orderId: '3', fraudFlagged: true },
      { ...valid, orderId: '4', status: 'CANCELLED' },
      { ...valid, orderId: '5', paymentStatus: 'PENDING' },
    ]
    expect(aggregatePrivateOrderActivity(excluded, 2)).toEqual([])
  })
})

describe('pins, fallback, and fair ranking', () => {
  const pin = {
    postId: 'post-1', scopeType: 'city' as const, scopeId: 'city-1',
    startsAt: '2026-07-29T08:00:00.000Z', expiresAt: '2026-07-29T10:00:00.000Z', priority: 10,
  }

  it('restricts official pin management to super admins and evaluates expiry/scope', () => {
    expect(canManageOfficialPins('super_admin', true)).toBe(true)
    expect(canManageOfficialPins('admin', true)).toBe(false)
    expect(canManageOfficialPins('vendor', true)).toBe(false)
    expect(canManageOfficialPins('super_admin', false)).toBe(false)
    expect(isPinActive(pin, new Date('2026-07-29T09:00:00.000Z'))).toBe(true)
    expect(isPinActive(pin, new Date('2026-07-29T10:00:00.000Z'))).toBe(false)
    expect(pinMatchesViewer(pin, { cityId: 'city-1' })).toBe(true)
    expect(pinMatchesViewer(pin, { cityId: 'city-2' })).toBe(false)
  })

  it('always returns a structured browse fallback without storing fake posts', () => {
    const cards = buildEmptyFeedFallback({
      nearbyVendorIds: [], affordableItemIds: [], recentItemIds: [],
      openVendorIds: [], categories: [],
    })
    expect(cards).toEqual([{ kind: 'browse_all', title: 'Browse all vendors', href: '/home', entityIds: [] }])
  })

  it('prevents a high-volume vendor from dominating fair rotation', () => {
    const ranked = rotateVendorsFairly([
      { vendorId: 'a', id: 'a1' }, { vendorId: 'a', id: 'a2' },
      { vendorId: 'a', id: 'a3' }, { vendorId: 'b', id: 'b1' },
      { vendorId: 'c', id: 'c1' },
    ], 4)
    expect(ranked.map((item) => item.vendorId)).toEqual(['a', 'b', 'c', 'a'])
  })
})
