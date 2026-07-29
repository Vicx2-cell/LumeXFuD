export interface VendorSettable {
  id: string
  shop_name: string
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  shop_photo_url: string | null
  logo_url: string | null
  opening_time: string | null
  closing_time: string | null
  pickup_enabled: boolean
  pickup_max_concurrent: number
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  location_photo_url: string | null
}
