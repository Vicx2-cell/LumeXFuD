// ─── Auth & Sessions ──────────────────────────────────────────────────────────

export interface Customer {
  id: string
  phone: string
  name: string | null
  hostel: string | null
  room_number: string | null
  default_delivery_address: string | null
  dispute_count: number
  last_dispute_at: string | null
  dispute_blocked_until: string | null
  deleted_at: string | null
  created_at: string
}

export interface Session {
  id: string
  user_id: string
  role: 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'
  expires_at: string
  ip_address: string | null
  user_agent: string | null
  revoked_at: string | null
  created_at: string
}

export interface OtpAttempt {
  id: string
  phone: string
  otp_hash: string
  expires_at: string
  used_at: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

export type VendorStatus = 'OPEN' | 'BUSY' | 'CLOSED'
export type SubscriptionTier = 'FOUNDING' | 'EARLY' | 'STANDARD'
export type TrustTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND'
export type MerchantCategory = 'restaurant' | 'supermarket' | 'pharmacy'

export interface Vendor {
  id: string
  phone: string
  shop_name: string
  owner_name: string
  logo_url: string | null
  shop_photo_url: string | null
  prep_time_minutes: number
  status: VendorStatus
  busy_until: string | null
  paused_until: string | null
  category: string
  merchant_category: MerchantCategory
  description: string | null
  paystack_subaccount_code: string | null
  bank_code: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  subscription_tier: SubscriptionTier
  subscription_paid_until: string | null
  avg_rating: number
  total_ratings: number
  reliability_score: number
  reliability_score_updated_at: string | null
  // Public store location (migration 090) — shown to customers + riders so they
  // can find and navigate to the shop. All optional; a pin is lat+lng together.
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  location_photo_url: string | null
  is_active: boolean
  approved_at: string | null
  approved_by: string | null
  created_at: string
  deleted_at: string | null
}

export type Merchant = Vendor

export interface MenuItem {
  id: string
  vendor_id: string
  name: string
  description: string | null
  price_kobo: number
  image_url: string | null
  category: 'RICE' | 'PROTEIN' | 'DRINKS' | 'SNACKS' | 'OTHER'
  product_category: string | null
  prescription_required: boolean
  is_available: boolean
  daily_limit: number | null
  sold_today: number
  display_order: number
  created_at: string
  deleted_at: string | null
}

// ─── Riders ───────────────────────────────────────────────────────────────────

export type RiderStatus = 'ONLINE' | 'BUSY' | 'OFFLINE'

export interface Rider {
  id: string
  phone: string
  full_name: string
  bike_plate: string | null
  bank_code: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  status: RiderStatus
  active_order_id: string | null
  last_status_update_at: string | null
  avg_rating: number
  total_ratings: number
  total_deliveries: number
  acceptance_rate: number
  reliability_score: number
  reliability_score_updated_at: string | null
  is_active: boolean
  approved_at: string | null
  approved_by: string | null
  created_at: string
  deleted_at: string | null
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'SCHEDULED'
  | 'PENDING'
  | 'VENDOR_ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'RIDER_ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'NO_SHOW'

export type OrderState =
  | 'placed'
  | 'vendor_ack'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'late_delivered'
  | 'cancelled'

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED'
export type DeliveryType = 'BIKE' | 'DOOR' | 'PICKUP'

export interface Order {
  id: string
  order_number: string
  customer_id: string
  vendor_id: string
  rider_id: string | null
  guest_phone: string | null
  status: OrderStatus
  order_state: OrderState | null
  delivery_type: DeliveryType
  delivery_address: string
  delivery_instructions: string | null
  subtotal: number
  platform_markup: number
  delivery_fee: number
  platform_delivery_cut: number
  rider_delivery_cut: number
  tip_amount: number
  total_amount: number
  paystack_reference: string
  idempotency_key: string | null
  payment_status: PaymentStatus
  rider_payment_status: 'PENDING' | 'HELD' | 'RELEASED'
  rider_auto_release_at: string | null
  placed_at: string | null
  promised_ready_at: string | null
  promised_ready_extended_at: string | null
  promised_ready_extension_count: number
  auto_cancel_reason: string | null
  late_delivery_credit_applied_at: string | null
  late_delivery_credit_kobo: number
  late_delivery_credit_stage: 'vendor_prep' | 'pickup_wait' | 'transit' | null
  late_delivery_credit_reference: string | null
  rider_payment_released_at: string | null
  delivery_photo_url: string | null
  vendor_accepted_at: string | null
  preparing_at: string | null
  ready_at: string | null
  rider_assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  // Pickup (order ahead) — null on BIKE/DOOR orders
  pickup_code: string | null
  pickup_eta_at: string | null
  pickup_deadline_at: string | null
  collected_at: string | null
  no_show_at: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string | null
  name: string
  price: number
  quantity: number
  subtotal: number
  notes: string | null
  created_at: string
}

export interface OrderMessage {
  id: string
  order_id: string
  sender_id: string
  sender_role: 'customer' | 'vendor' | 'rider'
  message_text: string
  message_type: 'TEXT' | 'STATUS_UPDATE' | 'DISPUTE_NOTE' | 'CONFIRMATION'
  read_at: string | null
  created_at: string
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface Payment {
  id: string
  order_id: string
  paystack_reference: string
  paystack_transaction_id: string | null
  amount: number
  status: PaymentStatus
  channel: string | null
  paid_at: string | null
  created_at: string
}

export interface ProcessedWebhook {
  id: string
  reference: string
  event: string
  payload: Record<string, unknown> | null
  processed_at: string
}

export interface Refund {
  id: string
  order_id: string
  paystack_transaction_reference: string
  paystack_refund_reference: string | null
  amount_kobo: number
  reason: string
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'NEEDS_ATTENTION'
  triggered_by: string
  failure_reason: string | null
  created_at: string
  completed_at: string | null
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export type WalletUserType = 'VENDOR' | 'RIDER'
export type WalletTransactionType = 'CREDIT' | 'DEBIT' | 'HOLD' | 'RELEASE' | 'FREEZE' | 'WITHDRAWAL'

export interface WalletBalance {
  user_id: string
  user_type: WalletUserType
  total_balance: number
  available_balance: number
  held_balance: number
  trust_tier: TrustTier
  wallet_pin_hash: string | null
  last_bank_added_at: string | null
  is_frozen: boolean
  updated_at: string
}

export interface WalletTransaction {
  id: string
  user_id: string
  user_type: WalletUserType
  type: WalletTransactionType
  amount: number
  balance_before: number
  balance_after: number
  reference: string | null
  order_id: string | null
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  paystack_transfer_code: string | null
  failure_reason: string | null
  created_at: string
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export interface VendorSubscription {
  id: string
  vendor_id: string
  amount: number
  paystack_reference: string
  paid_at: string
  period_start: string
  period_end: string
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
}

export interface VendorScore {
  id: string
  vendor_id: string
  avg_rating: number
  rating_count: number
  order_count_30d: number
  avg_prep_time: number
  order_completion_rate: number
  repeat_customer_rate: number
  cancel_rate: number
  dispute_rate: number
  composite_score: number
  visibility_tier: 'PREMIUM' | 'FEATURED' | 'STANDARD' | 'DECLINING'
  updated_at: string
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

// Customer rating for an order: a public vendor review (stars/review, migration
// 043) plus an optional private rider rating (rider_stars/rider_review,
// migration 044). One row per order; immutable.
export interface Rating {
  id: string
  order_id: string
  customer_id: string
  vendor_id: string
  stars: number
  review: string | null
  reviewer_name: string | null
  rider_id: string | null
  rider_stars: number | null
  rider_review: string | null
  created_at: string
}

// ─── Streaks & badges (cosmetic — no XP/levels, no money; see migration 037) ──

export interface CustomerStreak {
  customer_id: string
  current_streak_days: number
  best_streak_days: number
  last_order_date: string | null
  updated_at: string
}

export interface Badge {
  id: string            // slug, e.g. 'weekly-warrior'
  name: string
  description: string
  emoji: string
  sort_order: number
}

export interface CustomerBadge {
  customer_id: string
  badge_id: string
  earned_at: string
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface Admin {
  id: string
  phone: string
  name: string
  role: 'admin' | 'super_admin'
  is_active: boolean
  created_at: string
}

export interface AuditLog {
  id: string
  actor_id: string
  actor_role: string
  action: string
  target_table: string | null
  target_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface SuperAuditLog extends AuditLog {
  amount_kobo: number | null
}

export interface AdminDevice {
  id: string
  admin_id: string
  device_fingerprint: string
  device_name: string | null
  first_seen: string
  last_seen: string
}

// ─── System ───────────────────────────────────────────────────────────────────

export interface Settings {
  id: string
  value: Record<string, unknown>
  updated_by: string | null
  updated_at: string
}

export interface Notification {
  id: string
  user_id: string
  user_type: 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'ADMIN' | 'SUPER_ADMIN'
  channel: 'whatsapp' | 'sms' | 'push'
  template: string
  payload: Record<string, unknown> | null
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  termii_id: string | null
  error: string | null
  retry_count: number
  sent_at: string | null
  created_at: string
}

export interface TrendingData {
  id: 1
  orders_last_hour: number | null
  top_item_name: string | null
  top_item_count: number | null
  top_vendor_name: string | null
  new_vendor_name: string | null
  updated_at: string | null
}

export interface Dispute {
  id: string
  order_id: string
  customer_id: string
  reason: string
  description: string | null
  customer_photo_url: string | null
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED_REFUND' | 'RESOLVED_NO_ACTION'
  resolved_by: string | null
  resolved_at: string | null
  refund_id: string | null
  created_at: string
}
