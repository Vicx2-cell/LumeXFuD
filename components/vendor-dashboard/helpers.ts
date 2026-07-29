type VendorDashboardStatus = 'OPEN' | 'BUSY' | 'CLOSED'

interface VendorDashboardCustomer {
  phone: string | null
  name: string | null
  call_phone?: string | null
}

interface VendorDashboardOrderItem {
  id: string
  name: string
  quantity: number
  price: number
  notes: string | null
  addons?: Array<{ name: string; price_kobo: number }>
}

export interface VendorDashboardOrder {
  id: string
  order_number: string
  status: string
  delivery_type: 'BIKE' | 'DOOR' | 'PICKUP'
  delivery_address: string
  subtotal?: number | null
  created_at: string
  pickup_eta_at: string | null
  speed_target_at?: string | null
  promised_delivery_at?: string | null
  vendor_estimated_prep_minutes?: number | null
  vendor_estimated_delivery_minutes?: number | null
  speed_commitment_flagged_at?: string | null
  delay_detected_at?: string | null
  customer_id?: string | null
  rider_id?: string | null
  customers: VendorDashboardCustomer | null
  riders?: { full_name: string } | null
  order_items: VendorDashboardOrderItem[]
}

export interface VendorDashboardVendor {
  id: string
  shop_name: string
  phone?: string | null
  status: VendorDashboardStatus
  paused_until: string | null
  prep_time_minutes: number
  opening_time: string | null
  closing_time: string | null
  logo_url: string | null
  shop_photo_url: string | null
  pickup_enabled: boolean
  pickup_max_concurrent: number
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  subscription_tier?: string | null
  is_premium?: boolean | null
}

export interface VendorDashboardSummary {
  orders_today: number
  vendor_sales_today_kobo: number
  pending_orders: number
  active_orders: number
  preparing_orders: number
  ready_orders: number
  completed_today: number
  avg_prep_minutes: number | null
  store_status: VendorDashboardStatus
}

export interface VendorDashboardRecentOrder {
  id: string
  order_number: string
  status: string
  subtotal: number
  created_at: string
  order_items?: Array<{
    name: string
    quantity: number
  }>
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'New order',
  VENDOR_ACCEPTED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up',
}

export const STATUS_COLOR: Record<string, string> = {
  PENDING: '#F5A623',
  VENDOR_ACCEPTED: '#60a5fa',
  PREPARING: '#a78bfa',
  READY: '#4ade80',
  COMPLETED: 'rgba(255,255,255,0.35)',
  CANCELLED: '#f87171',
  NO_SHOW: '#f59e0b',
  RIDER_ASSIGNED: '#60a5fa',
  PICKED_UP: '#34d399',
}

export function formatMoney(kobo: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(kobo / 100)
}

export function initials(name: string | null | undefined) {
  const value = (name ?? '').trim()
  if (!value) return 'LX'
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
