import type { LucideIcon } from 'lucide-react'

export type VendorDashboardStatus = 'OPEN' | 'BUSY' | 'CLOSED'

export interface VendorDashboardCustomer {
  phone: string | null
  name: string | null
  call_phone?: string | null
}

export interface VendorDashboardOrderItem {
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
  total_amount: number
  created_at: string
  pickup_eta_at: string | null
  customer_id?: string | null
  customers: VendorDashboardCustomer | null
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

export interface VendorDashboardReview {
  id: string
  stars: number
  review: string | null
  created_at: string
}

export interface VendorDashboardReviewSummary {
  reviews: VendorDashboardReview[]
  avg_rating: number
  total_ratings: number
}

export interface VendorDashboardSummary {
  orders_today: number
  revenue_today_kobo: number
  pending_orders: number
  active_orders: number
  completed_today: number
  avg_prep_minutes: number | null
  store_status: VendorDashboardStatus
}

export interface VendorDashboardRecentOrder {
  id: string
  order_number: string
  status: string
  total_amount: number
  created_at: string
  order_items?: Array<{
    name: string
    quantity: number
  }>
}

export type TrendTone = 'amber' | 'blue' | 'green' | 'violet'

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

export const STATUS_TONE: Record<string, TrendTone> = {
  PENDING: 'amber',
  VENDOR_ACCEPTED: 'blue',
  PREPARING: 'violet',
  READY: 'green',
  COMPLETED: 'green',
  CANCELLED: 'amber',
  NO_SHOW: 'amber',
  RIDER_ASSIGNED: 'blue',
  PICKED_UP: 'green',
}

export function formatMoney(kobo: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(kobo / 100)
}

export function formatClock(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
  })
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

export function orderSummary(order: VendorDashboardOrder) {
  return (order.order_items ?? [])
    .slice(0, 3)
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(' · ')
}

export function trendDirection(delta: number) {
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

export function toneForStatus(status: string): TrendTone {
  return STATUS_TONE[status] ?? 'amber'
}

export function iconForTone(): LucideIcon | null {
  return null
}
