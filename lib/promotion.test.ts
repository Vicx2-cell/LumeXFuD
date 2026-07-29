import { describe, expect, it } from 'vitest'
import { canManagePromotions, canProvisionDva, guestPaystackChannels, promoFundSnapshot, quotePromotion, type Promotion } from './promotion'

const promo: Promotion = {
  discountType: 'PERCENTAGE', valueKobo: 0, percentageBps: 1000, percentageCapKobo: 5000,
  minimumSubtotalKobo: 10000, startsAt: '2025-01-01T00:00:00.000Z', expiresAt: null,
  status: 'ACTIVE', firstOrderOnly: false, groupOrderOnly: false,
}
const context = { subtotalKobo: 100000, deliveryFeeKobo: 10000, platformFeeKobo: 5000, isFirstOrder: true, isGroupOrder: false, now: new Date('2025-02-01') }

describe('launch promotion eligibility', () => {
  it('calculates integer-kobo percentages and caps them', () => expect(quotePromotion(promo, context)).toBe(5000))
  it('rejects expired, paused, not-started and below-minimum promotions', () => {
    expect(quotePromotion({ ...promo, expiresAt: '2025-01-02T00:00:00.000Z' }, context)).toBe(0)
    expect(quotePromotion({ ...promo, status: 'PAUSED' }, context)).toBe(0)
    expect(quotePromotion({ ...promo, startsAt: '2025-03-01T00:00:00.000Z' }, context)).toBe(0)
    expect(quotePromotion({ ...promo, minimumSubtotalKobo: 100001 }, context)).toBe(0)
  })
  it('enforces first/group/vendor/category/campus eligibility', () => {
    expect(quotePromotion({ ...promo, firstOrderOnly: true }, { ...context, isFirstOrder: false })).toBe(0)
    expect(quotePromotion({ ...promo, groupOrderOnly: true }, context)).toBe(0)
    expect(quotePromotion({ ...promo, eligibleVendorId: 'v1' }, { ...context, vendorId: 'v2' })).toBe(0)
    expect(quotePromotion({ ...promo, eligibleCategory: 'RICE' }, { ...context, category: 'DRINKS' })).toBe(0)
    expect(quotePromotion({ ...promo, eligibleCampusId: 'c1' }, { ...context, campusId: 'c2' })).toBe(0)
  })
  it('enforces total and customer use limits', () => {
    expect(quotePromotion({ ...promo, totalUsesLimit: 4 }, { ...context, totalUses: 4 })).toBe(0)
    expect(quotePromotion({ ...promo, usesPerCustomer: 1 }, { ...context, customerUses: 1 })).toBe(0)
  })
  it('caps delivery and platform fee discounts at the charge', () => {
    expect(quotePromotion({ ...promo, discountType: 'FREE_DELIVERY', valueKobo: 50000 }, context)).toBe(10000)
    expect(quotePromotion({ ...promo, discountType: 'PLATFORM_FEE', valueKobo: 50000 }, context)).toBe(5000)
  })
})

describe('fund, authorization, DVA and guest boundaries', () => {
  it('derives balances from immutable entries', () => expect(promoFundSnapshot(100000,25000,15000)).toEqual({availableKobo:60000,reservedKobo:15000,totalSpentKobo:25000}))
  it('rejects unauthorized promotion managers', () => { expect(canManagePromotions('customer')).toBe(false);expect(canManagePromotions('admin')).toBe(true);expect(canManagePromotions('super_admin')).toBe(true) })
  it('requires consent and both DVA gates', () => {
    expect(canProvisionDva({role:'customer',consent:true,featureEnabled:true,merchantEnabled:true})).toBe(true)
    expect(canProvisionDva({role:'customer',consent:false,featureEnabled:true,merchantEnabled:true})).toBe(false)
    expect(canProvisionDva({role:'customer',consent:true,featureEnabled:false,merchantEnabled:true})).toBe(false)
  })
  it('forces guest checkout onto transaction-specific Pay with Transfer', () => { expect(guestPaystackChannels(true)).toEqual(['bank_transfer']);expect(guestPaystackChannels(false)).toBeUndefined() })
})
