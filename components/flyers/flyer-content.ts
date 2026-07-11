import type { FlyerAspect, FlyerTemplateId } from './types'

export type FlyerMealData = {
  id: string
  name: string
  image: string
  price: string
  oldPrice: string | null
  discount: number | null
}

export type FlyerVendorData = {
  id: string
  name: string
  logo: string | null
  campus: string
  deliveryArea: string
  coverImage: string | null
  foodImages: string[]
  meals: FlyerMealData[]
  isActive: boolean
}

export type FlyerCampaignType =
  | 'vendor-launch'
  | 'meal-deal'
  | 'discount-promo'
  | 'free-delivery'
  | 'new-menu-alert'
  | 'campus-campaign'
  | 'weekend-promo'
  | 'brand-ad'

export type FlyerCampaignCopy = {
  headline: string
  subheadline: string
  cta: string
}

export type FlyerDraft = {
  template: FlyerTemplateId
  aspect: FlyerAspect
  vendor: FlyerVendorData
  meal: FlyerMealData | null
  copy: FlyerCampaignCopy
  headlineOverride: string | null
  useAutomaticCopy: boolean
  variant: number
}

export function money(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  return `₦${new Intl.NumberFormat('en-NG').format(value)}`
}

function mealDiscountLabel(meal: FlyerMealData | null) {
  if (!meal?.discount) return ''
  return `${meal.discount}% OFF`
}

export function campaignCopy(
  type: FlyerCampaignType,
  vendor: FlyerVendorData,
  meal: FlyerMealData | null,
): FlyerCampaignCopy {
  const mealName = meal?.name || vendor.meals[0]?.name || "Today's special"
  const mealPrice = meal?.price || vendor.meals[0]?.price || ''
  const discount = mealDiscountLabel(meal) || '20% OFF'

  switch (type) {
    case 'vendor-launch':
      return {
        headline: `${vendor.name} is now on LumeX Fud`,
        subheadline: `Now delivering around ${vendor.campus}`,
        cta: 'Order now',
      }
    case 'meal-deal':
      return {
        headline: mealName,
        subheadline: `Just ${mealPrice}`,
        cta: 'Order now',
      }
    case 'discount-promo':
      return {
        headline: `Get ${discount}`,
        subheadline: `At ${vendor.name}`,
        cta: 'Claim offer',
      }
    case 'free-delivery':
      return {
        headline: 'FREE DELIVERY',
        subheadline: `Order from ${vendor.name} today`,
        cta: 'Order now',
      }
    case 'new-menu-alert':
      return {
        headline: 'NEW MENU ALERT',
        subheadline: `${mealName} just landed`,
        cta: 'Try it now',
      }
    case 'campus-campaign':
      return {
        headline: `${vendor.campus}, what are we eating?`,
        subheadline: 'Your campus favourites, delivered',
        cta: 'Explore meals',
      }
    case 'weekend-promo':
      return {
        headline: 'Weekend cravings sorted',
        subheadline: `Order from ${vendor.name}`,
        cta: 'Order now',
      }
    case 'brand-ad':
      return {
        headline: 'Your next meal is a few taps away',
        subheadline: `Delivered around ${vendor.campus}`,
        cta: 'Explore vendors',
      }
  }
}

export function selectedMeal(vendor: FlyerVendorData, mealId: string | null) {
  if (!mealId) return vendor.meals[0] ?? null
  return vendor.meals.find((meal) => meal.id === mealId) ?? vendor.meals[0] ?? null
}
