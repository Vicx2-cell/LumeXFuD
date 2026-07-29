import { z } from 'zod'

const discountTypes = ['FIXED', 'PERCENTAGE', 'DELIVERY', 'FREE_DELIVERY', 'PLATFORM_FEE'] as const
const promotionKinds = ['STANDARD', 'VENDOR', 'GROUP_ORDER', 'REFERRAL', 'AMBASSADOR'] as const

export type Promotion = {
  discountType: typeof discountTypes[number]
  valueKobo: number
  percentageBps: number
  percentageCapKobo: number | null
  minimumSubtotalKobo: number
  startsAt: string
  expiresAt: string | null
  status: 'ACTIVE' | 'PAUSED'
  firstOrderOnly: boolean
  groupOrderOnly: boolean
  eligibleVendorId?: string | null
  eligibleCategory?: string | null
  eligibleCampusId?: string | null
  totalUsesLimit?: number | null
  usesPerCustomer?: number | null
}

export type PromotionContext = {
  subtotalKobo: number
  deliveryFeeKobo: number
  platformFeeKobo: number
  isFirstOrder: boolean
  isGroupOrder: boolean
  vendorId?: string | null
  category?: string | null
  campusId?: string | null
  totalUses?: number
  customerUses?: number
  now?: Date
}

export type PromotionQuoteResult = {
  eligible: boolean
  discountKobo: number
  reason?: string
}

export function evaluatePromotion(promotion: Promotion, input: PromotionContext): PromotionQuoteResult {
  const now = input.now ?? new Date()
  if (promotion.status !== 'ACTIVE') return { eligible: false, discountKobo: 0, reason: 'Promotion is paused.' }
  if (now < new Date(promotion.startsAt)) return { eligible: false, discountKobo: 0, reason: 'Promotion has not started yet.' }
  if (promotion.expiresAt && now >= new Date(promotion.expiresAt)) return { eligible: false, discountKobo: 0, reason: 'Promotion has expired.' }
  if (input.subtotalKobo < promotion.minimumSubtotalKobo) return { eligible: false, discountKobo: 0, reason: 'Basket minimum not reached.' }
  if (promotion.firstOrderOnly && !input.isFirstOrder) return { eligible: false, discountKobo: 0, reason: 'First order only.' }
  if (promotion.groupOrderOnly && !input.isGroupOrder) return { eligible: false, discountKobo: 0, reason: 'Group orders only.' }
  if (promotion.eligibleVendorId && promotion.eligibleVendorId !== input.vendorId) return { eligible: false, discountKobo: 0, reason: 'This code is for a different vendor.' }
  if (promotion.eligibleCategory && promotion.eligibleCategory.toUpperCase() !== input.category?.toUpperCase()) return { eligible: false, discountKobo: 0, reason: 'This code is for a different item category.' }
  if (promotion.eligibleCampusId && promotion.eligibleCampusId !== input.campusId) return { eligible: false, discountKobo: 0, reason: 'This code is for a different campus.' }
  if (promotion.totalUsesLimit != null && (input.totalUses ?? 0) >= promotion.totalUsesLimit) return { eligible: false, discountKobo: 0, reason: 'Promotion limit reached.' }
  if (promotion.usesPerCustomer != null && (input.customerUses ?? 0) >= promotion.usesPerCustomer) return { eligible: false, discountKobo: 0, reason: 'Customer limit reached.' }

  let discountKobo = 0
  switch (promotion.discountType) {
    case 'PERCENTAGE':
      discountKobo = Math.min(Math.floor(input.subtotalKobo * promotion.percentageBps / 10_000), promotion.percentageCapKobo ?? Number.MAX_SAFE_INTEGER)
      break
    case 'DELIVERY':
    case 'FREE_DELIVERY':
      discountKobo = Math.min(input.deliveryFeeKobo, promotion.valueKobo || input.deliveryFeeKobo)
      break
    case 'PLATFORM_FEE':
      discountKobo = Math.min(input.platformFeeKobo, promotion.valueKobo)
      break
    default:
      discountKobo = Math.min(input.subtotalKobo, promotion.valueKobo)
      break
  }

  if (discountKobo <= 0) return { eligible: false, discountKobo: 0, reason: 'Promotion has no applicable value.' }
  return { eligible: true, discountKobo }
}

export function quotePromotion(promotion: Promotion, input: PromotionContext): number {
  return evaluatePromotion(promotion, input).discountKobo
}

const optionalPositiveInt = z.number().int().positive().nullable().optional()
export const promotionInput = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((v) => v.toUpperCase()),
  promotion_kind: z.enum(promotionKinds).default('STANDARD'),
  discount_type: z.enum(discountTypes),
  value_kobo: z.number().int().nonnegative().default(0),
  percentage_bps: z.number().int().min(0).max(10_000).default(0),
  percentage_cap_kobo: optionalPositiveInt,
  minimum_subtotal_kobo: z.number().int().nonnegative().default(0),
  eligible_vendor_id: z.uuid().nullable().optional(),
  eligible_category: z.string().trim().max(80).nullable().optional(),
  eligible_campus_id: z.uuid().nullable().optional(),
  first_order_only: z.boolean().default(false),
  group_order_only: z.boolean().default(false),
  starts_at: z.iso.datetime(),
  expires_at: z.iso.datetime().nullable().optional(),
  total_uses_limit: optionalPositiveInt,
  uses_per_customer: optionalPositiveInt,
  funding_source: z.enum(['LUMEX', 'VENDOR']),
  campaign_budget_kobo: optionalPositiveInt,
  status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
}).superRefine((v, ctx) => {
  if (v.expires_at && new Date(v.expires_at) <= new Date(v.starts_at)) ctx.addIssue({ code: 'custom', path: ['expires_at'], message: 'Expiry must be after start' })
  if (v.discount_type === 'PERCENTAGE' && v.percentage_bps === 0) ctx.addIssue({ code: 'custom', path: ['percentage_bps'], message: 'Percentage must be greater than zero' })
  if (!['PERCENTAGE', 'FREE_DELIVERY'].includes(v.discount_type) && v.value_kobo === 0) ctx.addIssue({ code: 'custom', path: ['value_kobo'], message: 'Value must be greater than zero' })
  if (v.promotion_kind === 'VENDOR' && !v.eligible_vendor_id) ctx.addIssue({ code: 'custom', path: ['eligible_vendor_id'], message: 'Vendor promotion requires a vendor' })
  if (v.funding_source === 'VENDOR' && !v.eligible_vendor_id) ctx.addIssue({ code: 'custom', path: ['eligible_vendor_id'], message: 'Vendor-funded promotion requires a vendor' })
})

export function guestPaystackChannels(isGuest: boolean): Array<'bank_transfer'> | undefined {
  return isGuest ? ['bank_transfer'] : undefined
}

export function canManagePromotions(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin'
}

export function canProvisionDva(input: { role?: string | null; consent: boolean; featureEnabled: boolean; merchantEnabled: boolean }): boolean {
  return input.role === 'customer' && input.consent && input.featureEnabled && input.merchantEnabled
}

export function promoFundSnapshot(creditsKobo: number, committedKobo: number, reservedKobo: number) {
  return { availableKobo: creditsKobo - committedKobo - reservedKobo, reservedKobo, totalSpentKobo: committedKobo }
}
