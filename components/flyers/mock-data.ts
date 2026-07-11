import type { FlyerCampaign, FlyerTemplateData } from './types'

const vendors = {
  mamaChidinma: {
    vendorName: 'Mama Chidinma',
    vendorLogo: '/icons/icon-192-v2.png',
    foodImage: '/premium/dish-1.jpg',
    campus: 'ABSU - Uturu Campus',
    cta: 'Order now',
  },
  suyaSpot: {
    vendorName: 'Suya Spot',
    vendorLogo: '/icons/icon-512-v2.png',
    foodImage: '/premium/dish-2.jpg',
    campus: 'ABSU - Hostel Row',
    cta: 'Order now',
  },
  campusBites: {
    vendorName: 'Campus Bites',
    vendorLogo: '/icons/apple-touch-icon-v2.png',
    foodImage: '/premium/dish-3.jpg',
    campus: 'ABSU - Lecture Zone',
    cta: 'Order now',
  },
  lumex: {
    vendorName: 'LumeX Fud',
    vendorLogo: '/icons/icon-512-v2.png',
    foodImage: '/premium/hero-food.jpg',
    campus: 'Abia State University',
    cta: 'Open LumeX Fud',
  },
} satisfies Record<string, Pick<FlyerTemplateData, 'vendorName' | 'vendorLogo' | 'foodImage' | 'campus' | 'cta'>>

function makeData(
  vendor: keyof typeof vendors,
  overrides: Partial<Omit<FlyerTemplateData, 'vendorName' | 'vendorLogo' | 'foodImage' | 'campus' | 'cta'>> & {
    campus?: string
    cta?: string
    foodImage?: string
  },
): FlyerTemplateData {
  const base = vendors[vendor]
  return {
    vendorName: base.vendorName,
    vendorLogo: base.vendorLogo,
    foodImage: overrides.foodImage ?? base.foodImage,
    headline: overrides.headline ?? '',
    subheadline: overrides.subheadline ?? '',
    price: overrides.price ?? '',
    discount: overrides.discount ?? '',
    campus: overrides.campus ?? base.campus,
    cta: overrides.cta ?? base.cta,
  }
}

export const flyerCampaigns: FlyerCampaign[] = [
  {
    id: 'launch-mama-chidinma',
    template: 'vendor-launch',
    title: 'Vendor launch',
    note: 'Announcement poster for onboarding a new vendor into the marketplace.',
    data: makeData('mamaChidinma', {
      headline: 'Mama Chidinma is now on LumeX Fud',
      subheadline: 'Now delivering around ABSU',
      price: '',
      discount: '',
      campus: 'Now delivering around ABSU',
      cta: 'Order now',
    }),
  },
  {
    id: 'meal-deal-rice-chicken',
    template: 'meal-deal',
    title: 'Meal deal',
    note: 'Single-offer food poster with a large price lockup.',
    data: makeData('campusBites', {
      headline: 'Rice + Chicken',
      subheadline: 'Just ₦2,500',
      price: 'Just ₦2,500',
      discount: '',
      cta: 'Order now',
    }),
  },
  {
    id: 'discount-suya',
    template: 'discount-promo',
    title: 'Discount promo',
    note: 'High-urgency flyer where the discount is the hero.',
    data: makeData('mamaChidinma', {
      headline: 'GET 20% OFF',
      subheadline: 'Your favourites from Mama Chidinma',
      price: 'Your favourites from Mama Chidinma',
      discount: '20% OFF',
      cta: 'Claim in app',
    }),
  },
  {
    id: 'free-delivery-night',
    template: 'free-delivery',
    title: 'Free delivery',
    note: 'Convenience-led poster built around zero delivery cost.',
    data: makeData('mamaChidinma', {
      headline: 'FREE DELIVERY',
      subheadline: 'Order from Mama Chidinma today',
      price: 'Order from Mama Chidinma today',
      discount: '',
      campus: 'ABSU - Hostel Blocks A-F',
      cta: 'Order now',
    }),
  },
  {
    id: 'new-menu-alert',
    template: 'new-menu-alert',
    title: 'New menu alert',
    note: 'Fresh item campaign with a bold editorial feel.',
    data: makeData('campusBites', {
      headline: 'NEW MENU ALERT',
      subheadline: 'Something delicious just landed',
      price: '',
      discount: 'Something delicious just landed',
      cta: 'See menu',
    }),
  },
  {
    id: 'campus-campaign',
    template: 'campus-campaign',
    title: 'Campus campaign',
    note: 'Campus-specific food ad for hostels and lecture areas.',
    data: makeData('suyaSpot', {
      headline: 'ABSU, WHAT ARE WE EATING?',
      subheadline: 'Your campus favourites, delivered',
      price: '',
      discount: '',
      campus: 'ABSU - Faith, Marist & Annex',
      cta: 'Order now',
    }),
  },
  {
    id: 'weekend-promo',
    template: 'weekend-promo',
    title: 'Weekend promo',
    note: 'Louder weekend advertising for craving-led orders.',
    data: makeData('mamaChidinma', {
      headline: 'WEEKEND CRAVINGS SORTED',
      subheadline: 'Order from Mama Chidinma',
      price: 'Hot deals tonight',
      discount: '',
      cta: 'Start order',
    }),
  },
  {
    id: 'brand-ad',
    template: 'brand-ad',
    title: 'General brand ad',
    note: 'Marketplace-first ad for LumeX Fud itself.',
    data: makeData('lumex', {
      headline: 'YOUR NEXT MEAL IS A FEW TAPS AWAY',
      subheadline: 'Delivered around Abia State University',
      price: '',
      discount: '',
      cta: 'Open app',
    }),
  },
]

export const flyerVendorSwapDemo: FlyerCampaign[] = [
  {
    id: 'swap-mama',
    template: 'vendor-launch',
    title: 'Vendor swap demo',
    note: 'Same launch format with vendor A.',
    data: makeData('mamaChidinma', {
      headline: 'Mama Chidinma is now on LumeX Fud',
      subheadline: 'Now delivering around ABSU',
      price: '',
      discount: '',
      campus: 'Now delivering around ABSU',
      cta: 'Order now',
    }),
  },
  {
    id: 'swap-suya',
    template: 'vendor-launch',
    title: 'Vendor swap demo',
    note: 'Same launch format with vendor B.',
    data: makeData('suyaSpot', {
      headline: 'Suya Spot is now on LumeX Fud',
      subheadline: 'Now delivering around ABSU',
      price: '',
      discount: '',
      campus: 'Now delivering around ABSU',
      cta: 'Order now',
    }),
  },
]

export const flyerBrandAudit = {
  colors: 'Warm cream, amber, orange and near-black with a premium campus-food feel.',
  typography: 'Bricolage Grotesque for oversized headlines with short supporting copy.',
  tone: 'Bold, appetising, playful, campus-native, and ad-first rather than product-UI.',
  patterns: 'Full-bleed posters, oversized food crops, strong offer badges, compact branding, circles, waves, and minimal copy.',
}
