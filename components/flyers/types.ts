export type FlyerTemplateId =
  | 'vendor-launch'
  | 'meal-deal'
  | 'discount-promo'
  | 'free-delivery'
  | 'new-menu-alert'
  | 'campus-campaign'
  | 'weekend-promo'
  | 'brand-ad'

export type FlyerAspect = 'square' | 'status'

export type FlyerTemplateData = {
  vendorName: string
  vendorLogo: string | null
  foodImage: string
  headline: string
  subheadline: string
  price: string
  discount: string
  campus: string
  cta: string
}

export type FlyerCampaign = {
  id: string
  template: FlyerTemplateId
  title: string
  note: string
  data: FlyerTemplateData
}
