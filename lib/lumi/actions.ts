import { createSupabaseAdmin } from '@/lib/supabase/server'
import { templates } from './responses'
import { LumiReply } from './responses'

import type { Entities } from './intents'

// Reuse existing wallet helpers where available
import * as wallet from '@/lib/wallet'
import { getCustomerWallet } from '@/lib/customer-wallet'

export async function handleCheckBalance(userId: string): Promise<LumiReply> {
  const cw = await getCustomerWallet(userId).catch(() => null)
  const kobo = cw?.balance_kobo ?? 0
  const naira = Math.round(kobo / 100)
  return templates.balance(naira)
}

export async function handleBrowseVendors(): Promise<LumiReply> {
  const db = createSupabaseAdmin()
  const { data } = await db.from('vendors').select('id,name').eq('status', 'OPEN').limit(10)
  return templates.browseVendors(data ?? [])
}

export async function handleViewMenu(entities: Entities): Promise<LumiReply> {
  const vendor = (entities.vendor as string) || ''
  const db = createSupabaseAdmin()
  const { data } = await db.from('vendors').select('id').ilike('name', `%${vendor}%`).limit(1)
  if (!data || data.length === 0) return templates.viewMenu(vendor, [])
  const vendorId = data[0].id
  const { data: items } = await db.from('menu_items').select('name,price').eq('vendor_id', vendorId).limit(50)
  return templates.viewMenu(vendor, items ?? [])
}

export async function handleFundWallet(userId: string, entities: Entities): Promise<LumiReply> {
  const amount = Number(entities.amount ?? 0)
  if (!amount || amount <= 0) return { text: 'Please specify a valid amount to add.', quickReplies: ['Top up ₦500', 'Top up ₦1000'] }
  // Lumi does not handle payments directly, redirect user to wallet flow
  return templates.fundWallet(amount)
}

export async function handleWithdraw(): Promise<LumiReply> {
  // Withdrawals not allowed — app-only spend rule
  return templates.withdrawNotAvailable()
}

export async function handleOrderStatus(entities: Entities): Promise<LumiReply> {
  const orderNumber = (entities.orderNumber as string) || ''
  if (!orderNumber) return { text: 'Please provide an order number to check status.', quickReplies: ['My orders'] }
  const db = createSupabaseAdmin()
  const { data } = await db.from('orders').select('status').eq('order_number', orderNumber).limit(1).single()
  const status = data?.status ?? 'unknown'
  return templates.orderStatus(status)
}

export async function handleCancelOrder(userId: string, entities: Entities): Promise<LumiReply> {
  const orderNumber = (entities.orderNumber as string) || ''
  if (!orderNumber) return { text: 'Which order would you like to cancel?', quickReplies: ['Cancel my last order'] }
  const db = createSupabaseAdmin()
  // Reuse existing cancellation API where possible (orders table update + business rules)
  const { error } = await db.rpc('cancel_order_by_number', { _order_number: orderNumber, _requester_id: userId }).catch(() => ({ error: { message: 'failed' } }))
  if (error) return templates.cancelOrder(false)
  return templates.cancelOrder(true)
}

export async function handlePlaceOrder(userId: string, entities: Entities): Promise<LumiReply> {
  // Minimal orchestration: validate entities and start order flow
  const item = entities.item as string | undefined
  const qty = Number(entities.quantity ?? 1)
  const vendor = entities.vendor as string | undefined
  if (!item || !vendor) return { text: 'Tell me what you want and from which vendor, e.g., "Order 2 jollof from Mama T",', quickReplies: ['View vendors'] }
  if (!Number.isInteger(qty) || qty <= 0) return { text: 'Please provide a valid quantity.', quickReplies: ['1', '2', '3'] }
  // Lookup vendor and item
  const db = createSupabaseAdmin()
  const v = await db.from('vendors').select('id,name').ilike('name', `%${vendor}%`).limit(1)
  if (!v.data || v.data.length === 0) return { text: `Couldn't find vendor ${vendor}.`, quickReplies: ['View vendors'] }
  const vendorId = v.data[0].id
  const it = await db.from('menu_items').select('id,name,price,available').ilike('name', `%${item}%`).eq('vendor_id', vendorId).limit(1)
  if (!it.data || it.data.length === 0) return { text: `Couldn't find ${item} at ${vendor}.`, quickReplies: ['View menu'] }
  const menuItem = it.data[0]
  if (menuItem.available === false) return { text: `${menuItem.name} is currently not available.`, quickReplies: ['View menu'] }

  const total = Math.round(menuItem.price * qty)
  const summary = `${qty} x ${menuItem.name} from ${v.data[0].name}`
  // Save partial order in a lumi_orders staging table or return confirmation flow
  // For safety, just present confirmation to user; actual place order requires explicit confirm
  return templates.placeOrderConfirm(summary, total)
}

export async function handleHelp(): Promise<LumiReply> {
  return templates.help()
}
