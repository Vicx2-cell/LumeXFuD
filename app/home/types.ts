export interface HomeLocationRow {
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  zone_id: string
  zone_name: string
  uses_lodge_catalog: boolean
}

export interface VendorData {
  id: string
  slug: string | null
  shop_name: string
  logo_url: string | null
  shop_photo_url: string | null
  prep_time_minutes: number
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  category: string
  avg_rating: number
  total_ratings: number
  vendor_scores: Array<{ composite_score: number; visibility_tier: string }> | null
  kyc_verified?: boolean
}
