export interface OrderDetail {
  id: string
  order_number: string
  status: string
  payment_status: string
  delivery_type: string
  delivery_address: string
  subtotal: number
  platform_markup: number
  delivery_fee: number
  tip_amount: number
  total_amount: number
  prep_time_minutes: number | null
  busy_prep_buffer_minutes: number | null
  vendor_accepted_at: string | null
  preparing_at: string | null
  ready_at: string | null
  rider_assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  pickup_eta_at: string | null
  leave_at_gate: boolean | null
  delivery_photo_url: string | null
  collected_at: string | null
  no_show_at: string | null
  created_at: string
  rider_auto_release_at: string | null
  scheduled_for: string | null
  customer_id: string | null
  guest_phone: string | null
  vendor_id: string
  rider_id: string | null
  vendors: { shop_name: string; prep_time_minutes: number } | null
  riders: { full_name: string; phone: string; call_phone?: string | null; avatar_url: string | null } | null
  order_items: Array<{
    id: string
    name: string
    price: number
    quantity: number
    subtotal: number
    addons?: { name: string; price_kobo: number }[]
  }>
}
