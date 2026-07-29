const vendorId = '11111111-1111-4111-8111-111111111111'
const menuItemId = '22222222-2222-4222-8222-222222222222'
const addonRegularId = '33333333-3333-4333-8333-333333333333'
const addonLargeId = '44444444-4444-4444-8444-444444444444'
const addonEggId = '55555555-5555-4555-8555-555555555555'
const addonLongId = '66666666-6666-4666-8666-666666666666'
const addonSoldOutId = '77777777-7777-4777-8777-777777777777'
const zoneId = '88888888-8888-4888-8888-888888888888'
const cityId = '99999999-9999-4999-8999-999999999999'
const customerId = 'aaaaaaaa-0000-4000-8000-000000000001'
const riderId = 'aaaaaaaa-0000-4000-8000-000000000002'
const adminId = 'aaaaaaaa-0000-4000-8000-000000000003'
const superAdminId = 'aaaaaaaa-0000-4000-8000-000000000004'
const readyOrderId = 'aaaaaaaa-0000-4000-8000-000000000005'
const currentOrderId = 'aaaaaaaa-0000-4000-8000-000000000006'

export const playwrightIdentities = {
  customer: { sessionId: 'e2e-session-customer', userId: customerId, phone: '+2348011111111', role: 'customer' },
  vendor: { sessionId: 'e2e-session-vendor', userId: vendorId, phone: '+2348000000000', role: 'vendor' },
  rider: { sessionId: 'e2e-session-rider', userId: riderId, phone: '+2348022222222', role: 'rider' },
  admin: { sessionId: 'e2e-session-admin', userId: adminId, phone: '+2348033333333', role: 'admin' },
  super_admin: { sessionId: 'e2e-session-super-admin', userId: superAdminId, phone: '+2348044444444', role: 'super_admin' },
} as const

const vendor = {
  id: vendorId,
  slug: 'playwright-campus-kitchen',
  shop_name: 'Playwright Campus Kitchen',
  owner_name: 'Ada Vendor',
  phone: '+2348000000000',
  email: 'vendor@example.test',
  logo_url: '/icons/icon-192-v2.png',
  shop_photo_url: '/icons/icon-512-v2.png',
  location_photo_url: '/icons/icon-512-v2.png',
  prep_time_minutes: 18,
  status: 'OPEN',
  paused_until: null,
  category: 'RICE',
  description: 'Deterministic commerce verification storefront.',
  avg_rating: 4.7,
  total_ratings: 12,
  is_active: true,
  approval_state: 'approved',
  opening_time: '07:00',
  closing_time: '22:00',
  address_text: 'Fixture Lane',
  landmark: 'Near Test Hall',
  latitude: 5.8301,
  longitude: 7.3958,
  official_latitude: 5.8301,
  official_longitude: 7.3958,
  city_id: cityId,
  zone_id: zoneId,
  updated_at: '2026-07-22T00:00:00.000Z',
  deleted_at: null,
}

const menuItem = {
  id: menuItemId,
  vendor_id: vendorId,
  name: 'Fixture Jollof Bowl With A Very Long Product Name For Wrapping',
  description: 'A deterministic item used only by Playwright commerce tests.',
  price_kobo: 250000,
  image_url: '/icons/icon-512-v2.png',
  category: 'RICE',
  is_available: true,
  prep_time_minutes: 16,
  daily_limit: null,
  sold_today: 0,
  display_order: 1,
  deleted_at: null,
}

const addons = [
  { id: addonRegularId, menu_item_id: menuItemId, name: 'Regular bowl', price_kobo: 0, is_available: true, is_required: true, display_order: 1, deleted_at: null },
  { id: addonLargeId, menu_item_id: menuItemId, name: 'Large bowl', price_kobo: 50000, is_available: true, is_required: true, display_order: 2, deleted_at: null },
  { id: addonEggId, menu_item_id: menuItemId, name: 'Boiled egg', price_kobo: 50000, is_available: true, is_required: false, display_order: 3, deleted_at: null },
  {
    id: addonLongId,
    menu_item_id: menuItemId,
    name: 'Extra crunchy plantain with a long family-size name',
    price_kobo: 75000,
    is_available: true,
    is_required: false,
    display_order: 4,
    deleted_at: null,
  },
  { id: addonSoldOutId, menu_item_id: menuItemId, name: 'Sold-out smoky turkey', price_kobo: 120000, is_available: false, is_required: false, display_order: 5, deleted_at: null },
]

const settings = [
  { id: 'platform_markup', value: { amount_kobo: 10000 } },
  { id: 'delivery_fee_bike', value: { amount_kobo: 20000 } },
  { id: 'delivery_fee_door', value: { amount_kobo: 35000 } },
  { id: 'rider_delivery_cut_bike', value: { amount_kobo: 15000 } },
  { id: 'rider_delivery_cut_door', value: { amount_kobo: 25000 } },
  { id: 'platform_delivery_cut_bike', value: { amount_kobo: 5000 } },
  { id: 'platform_delivery_cut_door', value: { amount_kobo: 10000 } },
  { id: 'min_order_amount', value: { amount_kobo: 100000 } },
  { id: 'wallet_topup_bonus_percent', value: { value: 0 } },
  { id: 'platform_hours', value: { open: '07:00', close: '22:00', enforce: false } },
  { id: 'maintenance', value: { enabled: true, message: 'Ordering is paused for the launch drill.' } },
  // Test-fixture only: exercises the already-built handover UI without changing
  // the production feature default or persisted launch configuration.
  { id: 'feature.delivery_handover_v1', value: { enabled: true } },
]

const deliveryZone = {
  id: zoneId,
  city_id: cityId,
  status: 'ACTIVE',
  base_bike_fee: 20000,
  base_door_fee: 35000,
  platform_markup: 10000,
  rider_split: { BIKE: 15000, DOOR: 25000 },
  platform_split: { BIKE: 5000, DOOR: 10000 },
  created_at: '2026-07-22T00:00:00.000Z',
  name: 'Fixture Campus',
  uses_lodge_catalog: false,
}

function rowsFor(table: string): Record<string, unknown>[] {
  switch (table) {
    case 'vendors': return [vendor]
    case 'menu_items': return [menuItem]
    case 'menu_item_addons': return addons
    case 'settings': return settings
    case 'delivery_zones': return [deliveryZone]
    case 'cities': return [{ id: cityId, name: 'Fixture City', state: 'Abia', slug: 'fixture-city', status: 'ACTIVE' }]
    case 'social_profiles': return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', vendor_id: vendorId, handle: 'playwright-kitchen', display_name: vendor.shop_name, avatar_url: vendor.logo_url, is_verified: true, official_badge_kind: null }]
    case 'ratings': return [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', vendor_id: vendorId, stars: 5, review: 'Reliable fixture food.', created_at: '2026-07-22T00:00:00.000Z' }]
    case 'customers': return [{ id: customerId, phone: playwrightIdentities.customer.phone, name: 'Ada Customer', deleted_at: null, suspended_until: null }]
    case 'riders': return [{
      id: riderId, phone: playwrightIdentities.rider.phone, full_name: 'Rita Rider',
      status: 'BUSY', active_order_id: currentOrderId, avg_rating: 4.9, total_deliveries: 30,
      avatar_url: null, is_active: true, approval_state: 'approved', deleted_at: null,
    }]
    case 'admins': return [
      { id: adminId, phone: playwrightIdentities.admin.phone, name: 'Opal Admin', role: 'admin', is_active: true },
      { id: superAdminId, phone: playwrightIdentities.super_admin.phone, name: 'Sola Super Admin', role: 'super_admin', is_active: true },
    ]
    case 'sessions': return Object.values(playwrightIdentities).map((identity) => ({
      id: identity.sessionId,
      user_id: identity.userId,
      phone: identity.phone,
      role: identity.role,
      revoked_at: null,
      expires_at: '2099-01-01T00:00:00.000Z',
    }))
    case 'orders': return [{
      id: readyOrderId,
      order_number: 'LX-E2E-READY',
      vendor_id: vendorId,
      customer_id: customerId,
      rider_id: null,
      status: 'READY',
      delivery_type: 'BIKE',
      delivery_address: 'Fixture Hostel, Block A, Room 2',
      delivery_latitude: 5.8302,
      delivery_longitude: 7.3959,
      rider_delivery_cut: 15000,
      subtotal: 250000,
      total_amount: 285000,
      platform_markup: 10000,
      platform_delivery_cut: 5000,
      created_at: '2026-07-29T08:00:00.000Z',
      leave_at_gate: false,
    }, {
      id: currentOrderId,
      order_number: 'LX-E2E-CURRENT',
      vendor_id: vendorId,
      customer_id: customerId,
      rider_id: riderId,
      status: 'PICKED_UP',
      delivery_type: 'BIKE',
      delivery_address: 'Fixture Hostel, Block B, Room 4',
      delivery_latitude: 5.8302,
      delivery_longitude: 7.3959,
      rider_delivery_cut: 15000,
      subtotal: 250000,
      total_amount: 285000,
      platform_markup: 10000,
      platform_delivery_cut: 5000,
      picked_up_at: '2026-07-29T08:20:00.000Z',
      delivery_photo_url: null,
      created_at: '2026-07-29T08:00:00.000Z',
      leave_at_gate: false,
    }]
    case 'wallet_balances': return [
      {
        user_id: vendorId, user_type: 'VENDOR', wallet_pin_hash: 'fixture-hash',
        bank_verified_at: '2026-07-01T00:00:00.000Z', bank_account_number: '0000000000',
        bank_account_last4: '0000', bank_code: '000', bank_account_name: 'ADA VENDOR',
        bank_name: 'Fixture Bank', total_balance: 0, available_balance: 0, held_balance: 0,
        trust_tier: 'BRONZE', is_frozen: false, lifetime_earned: 0, total_withdrawals: 0,
      },
      {
        user_id: riderId, user_type: 'RIDER', wallet_pin_hash: 'fixture-hash',
        bank_verified_at: '2026-07-01T00:00:00.000Z', bank_account_number: '0000000001',
        bank_account_last4: '0001', bank_code: '000', bank_account_name: 'RITA RIDER',
        bank_name: 'Fixture Bank', total_balance: 0, available_balance: 0, held_balance: 0,
        trust_tier: 'BRONZE', is_frozen: false, lifetime_earned: 0, total_withdrawals: 0,
      },
    ]
    case 'follows':
    case 'posts':
    case 'lodges':
      return []
    default:
      return []
  }
}

type Filter = { column: string; op: 'eq' | 'is' | 'in' | 'not' | 'gt' | 'gte' | 'lte'; value: unknown }

class FixtureQuery {
  private filters: Filter[] = []
  private limitCount: number | null = null
  private countMode = false
  private mutationRow: Record<string, unknown> | null = null

  constructor(private table: string) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    this.countMode = Boolean(opts?.count || opts?.head)
    return this
  }

  eq(column: string, value: unknown) { this.filters.push({ column, op: 'eq', value }); return this }
  is(column: string, value: unknown) { this.filters.push({ column, op: 'is', value }); return this }
  in(column: string, value: unknown[]) { this.filters.push({ column, op: 'in', value }); return this }
  not(column: string, op: string, value: unknown) { this.filters.push({ column, op: 'not', value: { op, value } }); return this }
  gt(column: string, value: unknown) { this.filters.push({ column, op: 'gt', value }); return this }
  gte(column: string, value: unknown) { this.filters.push({ column, op: 'gte', value }); return this }
  lte(column: string, value: unknown) { this.filters.push({ column, op: 'lte', value }); return this }
  or(_expr: string) { return this }
  order(_column: string, _opts?: unknown) { return this }
  limit(count: number) { this.limitCount = count; return this }
  range(from: number, to: number) { this.limitCount = Math.max(0, to - from + 1); return this }

  async single() {
    const data = this.mutationRow ?? this.execute()[0] ?? null
    return { data, error: data ? null : { message: 'not found' } }
  }

  async maybeSingle() {
    return { data: this.execute()[0] ?? null, error: null }
  }

  insert(payload?: unknown) {
    const row = Array.isArray(payload) ? payload[0] : payload
    this.mutationRow = row && typeof row === 'object'
      ? { id: 'aaaaaaaa-0000-4000-8000-000000000099', ...row as Record<string, unknown> }
      : null
    return this
  }

  upsert(payload?: unknown) { return this.insert(payload) }
  update(payload?: unknown) {
    if (payload && typeof payload === 'object') this.mutationRow = payload as Record<string, unknown>
    return this
  }
  delete() { return this }

  then<TResult1 = { data: Record<string, unknown>[]; error: null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[]; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    const data = this.execute()
    return Promise.resolve({
      data: this.countMode ? [] : data,
      error: null,
      count: this.countMode ? data.length : undefined,
    }).then(onfulfilled, onrejected)
  }

  private execute() {
    let data = rowsFor(this.table)
    for (const filter of this.filters) {
      data = data.filter((row) => {
        const value = row[filter.column]
        if (filter.op === 'eq') return value === filter.value
        if (filter.op === 'is') return value === filter.value
        if (filter.op === 'in') return Array.isArray(filter.value) && filter.value.includes(value)
        if (filter.op === 'not') return value !== null
        if (filter.op === 'gt') return String(value) > String(filter.value)
        if (filter.op === 'gte') return String(value) >= String(filter.value)
        if (filter.op === 'lte') return String(value) <= String(filter.value)
        return true
      })
    }
    return this.limitCount === null ? data : data.slice(0, this.limitCount)
  }
}

export function createPlaywrightCommerceSupabase() {
  return {
    from(table: string) {
      return new FixtureQuery(table)
    },
    storage: {
      from(_bucket: string) {
        return {
          async list(path: string) {
            if (path.startsWith('verified/')) {
              return {
                data: [
                  { name: 'face.webp' },
                  { name: 'government_id.webp' },
                  { name: 'vehicle.webp' },
                  { name: 'food_safety.webp' },
                  { name: 'storefront.webp' },
                ],
                error: null,
              }
            }
            return { data: [], error: null }
          },
          async createSignedUrl(_path: string, _seconds: number) {
            return { data: { signedUrl: '/icons/icon-192-v2.png' }, error: null }
          },
        }
      },
    },
    async rpc(_name: string) {
      return { data: null, error: null }
    },
  }
}
