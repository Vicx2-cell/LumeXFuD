export interface VendorReview {
  id: string
  stars: number
  review: string | null
  created_at: string
}

export interface MenuAddon {
  id: string
  name: string
  price_kobo: number
  is_required: boolean
}

export interface VendorInfo {
  id: string
  slug: string | null
  shop_name: string
  owner_name: string
  logo_url: string | null
  shop_photo_url: string | null
  prep_time_minutes: number
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  category: string
  description: string | null
  avg_rating: number
  total_ratings: number
  opening_time: string | null
  closing_time: string | null
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  location_photo_url: string | null
  kyc_verified?: boolean
}

export interface MenuItem {
  id: string
  name: string
  description: string | null
  price_kobo: number
  image_url: string | null
  category: string
  is_available: boolean
  prep_time_minutes: number | null
  daily_limit: number | null
  sold_today: number
  display_order: number
  addons: MenuAddon[]
}
