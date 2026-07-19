import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCustomerWallet, getTopupLimits } from '@/lib/customer-wallet'
import { getMinimumOrderKobo } from '@/lib/delivery-zones'
import {
  computeDeliveryPriceEstimate,
  getDeliveryPricingConfig,
  haversineDistanceMeters,
} from '@/lib/delivery-pricing'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'
import type { SessionPayload } from '@/lib/session'
import {
  isConfirmationMessage,
  isFlowExitMessage,
  matchIntent,
  parseQuantityMessage,
  parseSelectionToken,
} from './intents'
import { lumiResponses } from './responses'
import { localGeneralResponse, securityResponse } from './local-intelligence'
import type {
  LumiActionResult,
  LumiConfirmationPayload,
  LumiConversationState,
  LumiEntities,
  LumiOrderDraft,
  LumiResponse,
} from './types'

type DbClient = ReturnType<typeof createSupabaseAdmin>

type LumiContext = {
  db: DbClient
  session: SessionPayload
  customerId: string
}

type VendorRow = {
  id: string
  shop_name: string
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  is_active: boolean
  zone_id: string | null
  city_id: string | null
  official_latitude: number | null
  official_longitude: number | null
  latitude: number | null
  longitude: number | null
}

type MenuItemRow = {
  id: string
  vendor_id: string
  name: string
  price_kobo: number
  is_available: boolean
  daily_limit: number | null
  sold_today: number
  display_order: number | null
}

type CustomerLocationRow = {
  label: string
  latitude: number
  longitude: number
  city_id: string | null
  zone_id: string | null
}

const CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'SCHEDULED', 'PENDING'] as const

function nextState(partial: Omit<LumiConversationState, 'version' | 'updatedAt'>): LumiConversationState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...partial,
  }
}

function extractAmount(message: string): number | undefined {
  const match = message
    .normalize('NFKC')
    .replace(/₦/g, ' ')
    .match(/\b(?:add|deposit|fund|top up|topup|withdraw|send|naira)\b(?:\s+my wallet(?: with)?)?\s*(?:with\s*)?(\d[\d,]*)/i)
  const fallback = message.match(/\b(\d[\d,]*)\b/)
  const raw = match?.[1] ?? fallback?.[1]
  if (!raw) return undefined
  const amount = Number.parseInt(raw.replace(/,/g, ''), 10)
  return Number.isFinite(amount) ? amount : undefined
}

async function listOpenVendors(ctx: LumiContext): Promise<Array<{ id: string; name: string }>> {
  const location = await getActiveCustomerLocation(ctx.db, ctx.customerId)
  let query = ctx.db
    .from('vendors')
    .select('id, shop_name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .or(notCurrentlySuspendedOr())
    .in('status', ['OPEN', 'BUSY'])
    .order('shop_name', { ascending: true })
    .limit(6)
  if (location?.zone_id) query = query.eq('zone_id', location.zone_id)
  const { data } = await query
  return ((data ?? []) as Array<{ id: string; shop_name: string }>).map((vendor) => ({
    id: vendor.id,
    name: vendor.shop_name,
  }))
}

async function findVendorsByName(ctx: LumiContext, name: string): Promise<Array<{ id: string; name: string }>> {
  const location = await getActiveCustomerLocation(ctx.db, ctx.customerId)
  let query = ctx.db
    .from('vendors')
    .select('id, shop_name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .or(notCurrentlySuspendedOr())
    .in('status', ['OPEN', 'BUSY'])
    .ilike('shop_name', `%${name}%`)
    .order('shop_name', { ascending: true })
    .limit(6)
  if (location?.zone_id) query = query.eq('zone_id', location.zone_id)
  const { data } = await query
  return ((data ?? []) as Array<{ id: string; shop_name: string }>).map((vendor) => ({
    id: vendor.id,
    name: vendor.shop_name,
  }))
}

async function getVendorById(db: DbClient, vendorId: string): Promise<VendorRow | null> {
  const { data } = await db
    .from('vendors')
    .select('id, shop_name, status, is_active, zone_id, city_id, official_latitude, official_longitude, latitude, longitude')
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as VendorRow | null) ?? null
}

async function getMenuForVendor(db: DbClient, vendorId: string): Promise<MenuItemRow[]> {
  const { data } = await db
    .from('menu_items')
    .select('id, vendor_id, name, price_kobo, is_available, daily_limit, sold_today, display_order')
    .eq('vendor_id', vendorId)
    .eq('is_available', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
    .limit(10)
  return (data ?? []) as MenuItemRow[]
}

async function findMenuItems(db: DbClient, vendorId: string, query: string): Promise<MenuItemRow[]> {
  const { data } = await db
    .from('menu_items')
    .select('id, vendor_id, name, price_kobo, is_available, daily_limit, sold_today, display_order')
    .eq('vendor_id', vendorId)
    .eq('is_available', true)
    .is('deleted_at', null)
    .ilike('name', `%${query}%`)
    .order('display_order', { ascending: true })
    .limit(8)
  return (data ?? []) as MenuItemRow[]
}

async function getMenuItemById(db: DbClient, vendorId: string, menuItemId: string): Promise<MenuItemRow | null> {
  const { data } = await db
    .from('menu_items')
    .select('id, vendor_id, name, price_kobo, is_available, daily_limit, sold_today, display_order')
    .eq('vendor_id', vendorId)
    .eq('id', menuItemId)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as MenuItemRow | null) ?? null
}

async function getActiveCustomerLocation(db: DbClient, customerId: string): Promise<CustomerLocationRow | null> {
  const { data } = await db
    .from('customer_locations')
    .select('label, latitude, longitude, city_id, zone_id')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  return (data as CustomerLocationRow | null) ?? null
}

async function buildOrderPreview(
  ctx: LumiContext,
  draft: LumiOrderDraft,
): Promise<
  | {
      vendor: VendorRow
      location: CustomerLocationRow
      subtotalKobo: number
      deliveryFeeKobo: number
      platformMarkupKobo: number
      totalKobo: number
    }
  | { error: LumiResponse }
> {
  if (!draft.vendorId || !draft.vendorName || draft.items.length === 0) {
    return { error: lumiResponses.fallback() }
  }

  const [vendor, location] = await Promise.all([
    getVendorById(ctx.db, draft.vendorId),
    getActiveCustomerLocation(ctx.db, ctx.customerId),
  ])

  if (!vendor || !vendor.is_active || !['OPEN', 'BUSY'].includes(vendor.status)) {
    return { error: lumiResponses.chooseVendor('That vendor is not available right now. Pick another vendor.', await listOpenVendors(ctx)) }
  }

  if (!location) {
    return { error: lumiResponses.missingLocation() }
  }

  if (location.zone_id && vendor.zone_id && location.zone_id !== vendor.zone_id) {
    return {
      error: lumiResponses.chooseVendor(
        'That vendor is outside your active delivery zone. Pick a vendor in your current zone.',
        await listOpenVendors(ctx),
      ),
    }
  }

  const itemIds = draft.items.map((item) => item.menuItemId)
  const { data: menuRows } = await ctx.db
    .from('menu_items')
    .select('id, vendor_id, name, price_kobo, is_available, daily_limit, sold_today')
    .eq('vendor_id', draft.vendorId)
    .in('id', itemIds)
    .is('deleted_at', null)

  const menuMap = new Map((menuRows ?? []).map((row) => [row.id as string, row as MenuItemRow]))
  let subtotalKobo = 0
  for (const item of draft.items) {
    const liveItem = menuMap.get(item.menuItemId)
    if (!liveItem || !liveItem.is_available) {
      return {
        error: {
          reply: `${item.name} is no longer available. Please choose another item.`,
          quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
        },
      }
    }
    if (liveItem.daily_limit !== null && liveItem.sold_today + item.quantity > liveItem.daily_limit) {
      return {
        error: {
          reply: `${liveItem.name} has reached its daily limit for now.`,
          quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
        },
      }
    }
    subtotalKobo += liveItem.price_kobo * item.quantity
  }

  const minimumOrder = await getMinimumOrderKobo(ctx.db)
  if (minimumOrder !== null && subtotalKobo < minimumOrder) {
    return {
      error: {
        reply: `This vendor’s minimum order is higher than your current basket. Please add more items before confirming.`,
        quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
      },
    }
  }

  const vendorLat = Number(vendor.official_latitude ?? vendor.latitude)
  const vendorLng = Number(vendor.official_longitude ?? vendor.longitude)
  if (!Number.isFinite(vendorLat) || !Number.isFinite(vendorLng)) {
    return {
      error: {
        reply: 'This vendor does not have a delivery location configured yet.',
        quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
      },
    }
  }

  const pricing = await getDeliveryPricingConfig({
    db: ctx.db,
    zoneId: location.zone_id ?? vendor.zone_id,
    vendorId: vendor.id,
  })

  if (!pricing) {
    return {
      error: {
        reply: 'Delivery pricing is not configured for this vendor right now.',
        quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
      },
    }
  }

  const distanceMeters = haversineDistanceMeters(
    { lat: vendorLat, lng: vendorLng },
    { lat: location.latitude, lng: location.longitude },
  )
  const estimate = computeDeliveryPriceEstimate({
    pricing,
    deliveryType: 'BIKE',
    distanceMeters,
  })

  if (estimate.distanceMeters > estimate.maxDeliveryDistanceMeters) {
    return {
      error: {
        reply: 'That delivery location is outside the configured service area for this vendor.',
        quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
      },
    }
  }
  if (estimate.distanceMeters > estimate.vendorDeliveryRadiusMeters) {
    return {
      error: {
        reply: 'This vendor does not deliver that far yet.',
        quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
      },
    }
  }

  return {
    vendor,
    location,
    subtotalKobo,
    deliveryFeeKobo: estimate.deliveryFeeKobo,
    platformMarkupKobo: pricing.platformMarkup,
    totalKobo: subtotalKobo + estimate.deliveryFeeKobo + pricing.platformMarkup,
  }
}

async function resolveOrderForCustomer(
  ctx: LumiContext,
  orderHint?: string,
) {
  let query = ctx.db
    .from('orders')
    .select('id, order_number, status, total_amount')
    .eq('customer_id', ctx.customerId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (orderHint) {
    query = ctx.db
      .from('orders')
      .select('id, order_number, status, total_amount')
      .eq('customer_id', ctx.customerId)
      .or(`order_number.eq.${orderHint},id.eq.${orderHint.toLowerCase()}`)
      .limit(1)
  }

  const { data } = await query.maybeSingle()
  return (data as { id: string; order_number: string; status: string; total_amount: number } | null) ?? null
}

async function listCancellableOrders(ctx: LumiContext) {
  const { data } = await ctx.db
    .from('orders')
    .select('id, order_number, status')
    .eq('customer_id', ctx.customerId)
    .in('status', [...CANCELLABLE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(4)
  return (data ?? []) as Array<{ id: string; order_number: string; status: string }>
}

async function handleBrowseVendors(ctx: LumiContext): Promise<LumiActionResult> {
  const vendors = await listOpenVendors(ctx)
  return {
    response: lumiResponses.browseVendors(vendors),
    nextState: nextState({
      step: 'awaiting_vendor_selection',
      activeIntent: 'browse_vendors',
    }),
  }
}

async function handleCheckBalance(ctx: LumiContext): Promise<LumiActionResult> {
  const wallet = await getCustomerWallet(ctx.customerId)
  return { response: lumiResponses.balance(wallet?.balance_kobo ?? 0), clearState: true }
}

async function handleViewMenu(ctx: LumiContext, entities: LumiEntities, currentState?: LumiConversationState): Promise<LumiActionResult> {
  const vendorIdToken = entities.vendorId ?? parseSelectionToken(entities.vendorName ?? '', 'vendor')
  if (vendorIdToken) {
    const vendor = await getVendorById(ctx.db, vendorIdToken)
    if (!vendor) {
      return { response: lumiResponses.orderNotFound(), clearState: true }
    }
    const menu = await getMenuForVendor(ctx.db, vendor.id)
    return {
      response: lumiResponses.menu(vendor.shop_name, menu.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price_kobo,
        available: item.is_available,
      }))),
      nextState: nextState({
        step: 'awaiting_menu_item',
        activeIntent: currentState?.activeIntent === 'place_order' ? 'place_order' : 'view_menu',
        orderDraft: {
          vendorId: vendor.id,
          vendorName: vendor.shop_name,
          items: [],
        },
      }),
    }
  }

  if (!entities.vendorName) {
    const vendors = await listOpenVendors(ctx)
    return {
      response: lumiResponses.chooseVendor('Which vendor would you like to view?', vendors),
      nextState: nextState({
        step: 'awaiting_vendor_selection',
        activeIntent: currentState?.activeIntent === 'place_order' ? 'place_order' : 'view_menu',
      }),
    }
  }

  const matches = await findVendorsByName(ctx, entities.vendorName)
  if (matches.length !== 1) {
    return {
      response: lumiResponses.chooseVendor(
        matches.length > 1
          ? `I found a few vendors matching "${entities.vendorName}". Which one did you mean?`
          : `I could not find "${entities.vendorName}". Pick one of these instead.`,
        matches.length > 0 ? matches : await listOpenVendors(ctx),
      ),
      nextState: nextState({
        step: 'awaiting_vendor_selection',
        activeIntent: currentState?.activeIntent === 'place_order' ? 'place_order' : 'view_menu',
      }),
    }
  }

  return handleViewMenu(ctx, { vendorId: matches[0].id }, currentState)
}

async function handlePlaceOrder(ctx: LumiContext, entities: LumiEntities, currentState?: LumiConversationState): Promise<LumiActionResult> {
  if (!entities.vendorName && !currentState?.orderDraft?.vendorId) {
    const vendors = await listOpenVendors(ctx)
    return {
      response: lumiResponses.chooseVendor('Which vendor would you like to order from?', vendors),
      nextState: nextState({
        step: 'awaiting_vendor_selection',
        activeIntent: 'place_order',
      }),
    }
  }

  let orderDraft = currentState?.orderDraft ?? { items: [] }

  if (!orderDraft.vendorId && entities.vendorName) {
    const vendors = await findVendorsByName(ctx, entities.vendorName)
    if (vendors.length !== 1) {
      return {
        response: lumiResponses.chooseVendor(
          vendors.length > 1
            ? `I found a few vendors matching "${entities.vendorName}". Which one should I use?`
            : `I could not find "${entities.vendorName}". Pick one of these vendors.`,
          vendors.length > 0 ? vendors : await listOpenVendors(ctx),
        ),
        nextState: nextState({
          step: 'awaiting_vendor_selection',
          activeIntent: 'place_order',
          orderDraft,
        }),
      }
    }
    orderDraft = {
      ...orderDraft,
      vendorId: vendors[0].id,
      vendorName: vendors[0].name,
    }
  }

  if (!orderDraft.vendorId || !orderDraft.vendorName) {
    return {
      response: lumiResponses.chooseVendor('Which vendor would you like to order from?', await listOpenVendors(ctx)),
      nextState: nextState({
        step: 'awaiting_vendor_selection',
        activeIntent: 'place_order',
      }),
    }
  }

  if (!entities.itemName && orderDraft.items.length === 0) {
    const menu = await getMenuForVendor(ctx.db, orderDraft.vendorId)
    return {
      response: lumiResponses.menu(orderDraft.vendorName, menu.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price_kobo,
        available: item.is_available,
      }))),
      nextState: nextState({
        step: 'awaiting_menu_item',
        activeIntent: 'place_order',
        orderDraft,
      }),
    }
  }

  if (entities.itemId) {
    const menuItem = await getMenuItemById(ctx.db, orderDraft.vendorId, entities.itemId)
    if (!menuItem || !menuItem.is_available) {
      return {
        response: {
          reply: 'That item is no longer available. Please choose another one.',
          quickReplies: [{ id: 'cancel-flow', label: 'Cancel', value: 'cancel' }],
        },
        nextState: nextState({
          step: 'awaiting_menu_item',
          activeIntent: 'place_order',
          orderDraft,
        }),
      }
    }
    orderDraft = {
      ...orderDraft,
      items: [{ menuItemId: menuItem.id, name: menuItem.name, quantity: 1, unitPrice: menuItem.price_kobo }],
    }
  }

  if (entities.itemName && orderDraft.items.length === 0) {
    const itemName = entities.itemName
    const vendorId = orderDraft.vendorId
    if (!vendorId || !itemName) {
      return {
        response: {
          reply: 'Please choose a vendor first.',
          quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
        },
        clearState: true,
      }
    }
    const matches = await findMenuItems(ctx.db, vendorId, itemName)
    if (matches.length !== 1) {
      const vendorName = orderDraft.vendorName ?? 'this vendor'
      return {
        response: lumiResponses.menu(vendorName, (matches.length > 0 ? matches : await getMenuForVendor(ctx.db, vendorId)).map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price_kobo,
          available: item.is_available,
        }))),
        nextState: nextState({
          step: 'awaiting_menu_item',
          activeIntent: 'place_order',
          orderDraft,
        }),
      }
    }
    orderDraft = {
      ...orderDraft,
      items: [{ menuItemId: matches[0].id, name: matches[0].name, quantity: 1, unitPrice: matches[0].price_kobo }],
    }
  }

  if (orderDraft.items.length === 0) {
    const vendorId = orderDraft.vendorId
    if (!vendorId) {
      return {
        response: {
          reply: 'Please choose a vendor first.',
          quickReplies: [{ id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' }],
        },
        clearState: true,
      }
    }
    const vendorName = orderDraft.vendorName ?? 'this vendor'
    return {
      response: lumiResponses.menu(vendorName, (await getMenuForVendor(ctx.db, vendorId)).map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price_kobo,
        available: item.is_available,
      }))),
      nextState: nextState({
        step: 'awaiting_menu_item',
        activeIntent: 'place_order',
        orderDraft,
      }),
    }
  }

  const quantity = entities.quantity ?? orderDraft.items[0].quantity
  if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
    return {
      response: lumiResponses.askQuantity(orderDraft.items[0].name),
      nextState: nextState({
        step: 'awaiting_quantity',
        activeIntent: 'place_order',
        orderDraft,
      }),
    }
  }

  orderDraft = {
    ...orderDraft,
    items: [{ ...orderDraft.items[0], quantity }],
  }

  const preview = await buildOrderPreview(ctx, orderDraft)
  if ('error' in preview) {
    return { response: preview.error, clearState: true }
  }

  return {
    response: lumiResponses.confirmOrder({
      vendorName: orderDraft.vendorName ?? 'your selected vendor',
      itemName: orderDraft.items[0].name,
      quantity,
      subtotalKobo: preview.subtotalKobo,
      deliveryFeeKobo: preview.deliveryFeeKobo,
      platformMarkupKobo: preview.platformMarkupKobo,
      totalKobo: preview.totalKobo,
      address: preview.location.label,
    }),
    nextState: nextState({
      step: 'awaiting_order_confirmation',
      activeIntent: 'place_order',
      orderDraft,
    }),
  }
}

async function handleOrderStatus(ctx: LumiContext, entities: LumiEntities): Promise<LumiActionResult> {
  const order = await resolveOrderForCustomer(ctx, entities.orderId)
  if (!order) {
    return {
      response: {
        reply: 'I could not find a recent order on your account.',
        quickReplies: [{ id: 'orders-page', label: 'Orders page', value: '/orders' }],
      },
      clearState: true,
    }
  }

  return {
    response: lumiResponses.latestOrderStatus({
      id: order.order_number,
      status: order.status,
      total: order.total_amount,
    }),
    clearState: true,
  }
}

async function handleFundWallet(_ctx: LumiContext, entities: LumiEntities): Promise<LumiActionResult> {
  const amount = entities.amount
  if (!amount) {
    return {
      response: lumiResponses.fundWalletAskAmount(),
      nextState: nextState({
        step: 'awaiting_funding_amount',
        activeIntent: 'fund_wallet',
      }),
    }
  }

  const amountKobo = amount * 100
  const limits = await getTopupLimits()
  if (amountKobo < limits.minKobo || amountKobo > limits.maxKobo) {
    return {
      response: {
        reply: `Top-up amounts must stay between ${limits.minKobo / 100} and ${limits.maxKobo / 100} naira.`,
        quickReplies: [{ id: 'fund-wallet', label: 'Try again', value: 'fund my wallet' }],
      },
      clearState: true,
    }
  }

  return {
    response: lumiResponses.fundWalletConfirm(amountKobo),
    nextState: nextState({
      step: 'awaiting_payment_confirmation',
      activeIntent: 'fund_wallet',
      pendingAmount: amount,
    }),
  }
}

async function handleCancelOrder(ctx: LumiContext, entities: LumiEntities): Promise<LumiActionResult> {
  if (entities.orderId) {
    const order = await resolveOrderForCustomer(ctx, entities.orderId)
    if (!order) return { response: lumiResponses.orderNotFound(), clearState: true }
    if (!CANCELLABLE_STATUSES.includes(order.status as (typeof CANCELLABLE_STATUSES)[number])) {
      return { response: lumiResponses.orderNotCancellable(), clearState: true }
    }
    return {
      response: lumiResponses.cancelOrderConfirm(order.order_number),
      nextState: nextState({
        step: 'awaiting_cancellation_confirmation',
        activeIntent: 'cancel_order',
        pendingOrderId: order.id,
      }),
    }
  }

  const orders = await listCancellableOrders(ctx)
  if (orders.length === 0) {
    return { response: lumiResponses.orderNotCancellable(), clearState: true }
  }
  if (orders.length === 1) {
    return {
      response: lumiResponses.cancelOrderConfirm(orders[0].order_number),
      nextState: nextState({
        step: 'awaiting_cancellation_confirmation',
        activeIntent: 'cancel_order',
        pendingOrderId: orders[0].id,
      }),
    }
  }

  return {
    response: lumiResponses.askOrderSelection(orders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
    }))),
    nextState: nextState({
      step: 'awaiting_order_selection',
      activeIntent: 'cancel_order',
    }),
  }
}

async function continueVendorSelection(
  ctx: LumiContext,
  message: string,
  state: LumiConversationState,
): Promise<LumiActionResult> {
  const vendorToken = parseSelectionToken(message, 'vendor')
  const vendorEntities: LumiEntities = vendorToken ? { vendorId: vendorToken } : { vendorName: message }
  if (state.activeIntent === 'place_order') {
    return handlePlaceOrder(ctx, vendorEntities, state)
  }
  return handleViewMenu(ctx, vendorEntities, state)
}

async function continueMenuSelection(
  ctx: LumiContext,
  message: string,
  state: LumiConversationState,
): Promise<LumiActionResult> {
  if (!state.orderDraft?.vendorId) {
    return { response: lumiResponses.fallback(), clearState: true }
  }
  const menuToken = parseSelectionToken(message, 'menu')
  return handlePlaceOrder(ctx, menuToken ? { itemId: menuToken } : { itemName: message }, state)
}

async function continueQuantity(
  ctx: LumiContext,
  message: string,
  state: LumiConversationState,
): Promise<LumiActionResult> {
  const qtyToken = parseSelectionToken(message, 'qty')
  const quantity = qtyToken ? Number.parseInt(qtyToken, 10) : parseQuantityMessage(message)
  if (!quantity || quantity <= 0) {
    return {
      response: lumiResponses.askQuantity(state.orderDraft?.items[0]?.name ?? 'that item'),
      nextState: state,
    }
  }
  return handlePlaceOrder(ctx, { quantity }, state)
}

async function continueFundingAmount(
  ctx: LumiContext,
  message: string,
): Promise<LumiActionResult> {
  const amount = extractAmount(message)
  if (!amount || amount <= 0) {
    return {
      response: lumiResponses.fundWalletAskAmount(),
      nextState: nextState({
        step: 'awaiting_funding_amount',
        activeIntent: 'fund_wallet',
      }),
    }
  }
  return handleFundWallet(ctx, { amount })
}

async function continueOrderSelection(
  ctx: LumiContext,
  message: string,
): Promise<LumiActionResult> {
  const orderId = parseSelectionToken(message, 'order')
  if (!orderId) {
    return handleCancelOrder(ctx, {})
  }
  return handleCancelOrder(ctx, { orderId })
}

async function continueConfirmationStep(
  state: LumiConversationState,
  response: LumiResponse,
): Promise<LumiActionResult> {
  return { response, nextState: state }
}

export async function processLumiMessage(
  ctx: LumiContext,
  message: string,
  state: LumiConversationState | null,
): Promise<LumiActionResult> {
  const security = securityResponse(message)
  if (security) return { response: security }

  if (isFlowExitMessage(message) && state?.step && state.step !== 'idle') {
    return { response: lumiResponses.cancelled(), clearState: true }
  }

  if (state && state.step !== 'idle') {
    switch (state.step) {
      case 'awaiting_vendor_selection':
        return continueVendorSelection(ctx, message, state)
      case 'awaiting_menu_item':
        return continueMenuSelection(ctx, message, state)
      case 'awaiting_quantity':
        return continueQuantity(ctx, message, state)
      case 'awaiting_funding_amount':
        return continueFundingAmount(ctx, message)
      case 'awaiting_order_selection':
        return continueOrderSelection(ctx, message)
      case 'awaiting_order_confirmation':
        return continueConfirmationStep(state, isConfirmationMessage(message)
          ? {
              reply: 'Tap "Confirm order" below and I’ll hand the request to the regular checkout flow.',
              quickReplies: [
                { id: 'confirm-order', label: 'Confirm order', value: 'confirm_order' },
                { id: 'cancel-flow', label: 'Cancel', value: 'cancel' },
              ],
            }
          : lumiResponses.confirmOrder({
              vendorName: state.orderDraft?.vendorName ?? 'that vendor',
              itemName: state.orderDraft?.items[0]?.name ?? 'that item',
              quantity: state.orderDraft?.items[0]?.quantity ?? 1,
              subtotalKobo: (state.orderDraft?.items[0]?.unitPrice ?? 0) * (state.orderDraft?.items[0]?.quantity ?? 1),
              deliveryFeeKobo: 0,
              platformMarkupKobo: 0,
              totalKobo: (state.orderDraft?.items[0]?.unitPrice ?? 0) * (state.orderDraft?.items[0]?.quantity ?? 1),
              address: 'your saved location',
            }))
      case 'awaiting_payment_confirmation':
        return continueConfirmationStep(state, {
          reply: isConfirmationMessage(message)
            ? 'Tap "Continue" below and I’ll open the normal wallet top-up flow.'
            : `I’m still waiting to confirm your top-up.`,
          quickReplies: [
            { id: 'confirm-funding', label: 'Continue', value: 'confirm_funding' },
            { id: 'cancel-flow', label: 'Cancel', value: 'cancel' },
          ],
        })
      case 'awaiting_cancellation_confirmation':
        return continueConfirmationStep(state, {
          reply: isConfirmationMessage(message)
            ? 'Tap "Yes, cancel it" below and I’ll use the regular cancellation flow.'
            : 'I’m waiting for your cancellation confirmation.',
          quickReplies: [
            { id: 'confirm-cancel-order', label: 'Yes, cancel it', value: 'confirm_cancel_order' },
            { id: 'keep-order', label: 'Keep order', value: 'cancel' },
          ],
        })
      default:
        break
    }
  }

  const intentResult = matchIntent(message)
  switch (intentResult.intent) {
    case 'check_balance':
      return handleCheckBalance(ctx)
    case 'browse_vendors':
      return handleBrowseVendors(ctx)
    case 'view_menu':
      return handleViewMenu(ctx, intentResult.entities)
    case 'place_order':
      return handlePlaceOrder(ctx, intentResult.entities)
    case 'order_status':
      return handleOrderStatus(ctx, intentResult.entities)
    case 'fund_wallet':
      return handleFundWallet(ctx, intentResult.entities)
    case 'withdraw':
      return { response: lumiResponses.withdrawUnavailable(), clearState: true }
    case 'cancel_order':
      return handleCancelOrder(ctx, intentResult.entities)
    case 'help':
      return { response: lumiResponses.help(), clearState: true }
    case 'fallback':
    default:
      return { response: localGeneralResponse(message) ?? lumiResponses.fallback(), clearState: true }
  }
}

export async function createLumiContext(session: SessionPayload): Promise<LumiContext | null> {
  if (session.role !== 'customer') return null
  const db = createSupabaseAdmin()
  const customerId = session.userId ?? null
  if (customerId) return { db, session, customerId }

  const { data } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  const resolvedId = (data as { id: string } | null)?.id ?? null
  if (!resolvedId) return null
  return { db, session, customerId: resolvedId }
}

export async function buildConfirmationPayload(
  ctx: LumiContext,
  state: LumiConversationState | null,
): Promise<LumiConfirmationPayload | null> {
  if (!state) return null

  if (state.activeIntent === 'place_order' && state.step === 'awaiting_order_confirmation' && state.orderDraft) {
    const preview = await buildOrderPreview(ctx, state.orderDraft)
    if ('error' in preview) return null
    return {
      action: 'place_order',
      requestBody: {
        vendor_id: state.orderDraft.vendorId,
        items: state.orderDraft.items.map((item) => ({
          menu_item_id: item.menuItemId,
          quantity: item.quantity,
          addons: [],
        })),
        delivery_type: 'BIKE',
        delivery_address: preview.location.label,
        city_id: preview.location.city_id,
        zone_id: preview.location.zone_id,
        delivery_latitude: preview.location.latitude,
        delivery_longitude: preview.location.longitude,
        tip_amount: 0,
        payment_method: 'PAYSTACK',
      },
    }
  }

  if (state.activeIntent === 'fund_wallet' && state.step === 'awaiting_payment_confirmation' && state.pendingAmount) {
    return {
      action: 'fund_wallet',
      requestBody: {
        amount_naira: state.pendingAmount,
      },
    }
  }

  if (state.activeIntent === 'cancel_order' && state.step === 'awaiting_cancellation_confirmation' && state.pendingOrderId) {
    return {
      action: 'cancel_order',
      orderId: state.pendingOrderId,
    }
  }

  return null
}
