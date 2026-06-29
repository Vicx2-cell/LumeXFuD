import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdmin } from './supabase/server'
import { normalizePhone, safeNormalizePhone } from './phone'
import { detectRole } from './session'
import { generateOrderNumber } from './order-number'
import { askLlama, isLlamaConfigured } from './llm'
import { sendText, sendButtons, sendList, type WARow } from './whatsapp'

// ─── The WhatsApp bot "brain" ────────────────────────────────────────────────
// Per inbound message:
//   (a) mode=human  → stop auto-replying, just log to the inbox
//   (b) else resolve the sender's role against the real tables, then
//   (c) route: customer → ordering state machine; vendor/rider → LLM FAQ /
//       human handoff; unknown → menu (+ vendor/rider lead capture).
//
// Auth model: the WhatsApp phone IS the identity (Meta has already verified it).
// We NEVER ask for, accept, or log a PIN in chat; anything sensitive becomes a
// one-time link to the web app (the phone owns that session there).

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lumexfud.com.ng'

// Pricing + tiers are LOCKED platform facts (see CLAUDE.md). Kept here as the
// LLM's grounding so vendor/rider FAQ answers are accurate and on-brand.
const FAQ_SYSTEM = `You are LumeX Fud's WhatsApp support assistant for a campus food-delivery platform at Abia State University (ABSU), Nigeria. Tagline: "Campus life, simplified." Use warm Nigerian English. Be concise (WhatsApp-length). Never ask for or accept PINs, passwords, card numbers or bank details in chat — for anything sensitive, tell them to use the LumeX app (${APP_URL}).

Platform facts (do not contradict):
- Digital payments only via Paystack; no cash on delivery.
- Platform food markup: ₦250 per order. Minimum order ₦500. Platform hours 7am–10pm.
- Delivery: Bike ₦500 (rider gets ₦400), Door ₦1,000 (rider gets ₦800).
- Rider payouts: 24-hour hold after delivery confirmed, paid out (riders are paid every Friday without fail).
- Vendor payouts: 3-day hold after an order is completed.
- Vendor subscription tiers: Founding (first 3) ₦10,000/month, no setup, locked 12 months; Early (vendors 4–10) ₦25,000 setup + ₦12,000/month; Standard (vendor 11+) ₦50,000 setup + ₦15,000/month.
- Order flow: PENDING → VENDOR_ACCEPTED → PREPARING → READY → RIDER_ASSIGNED → PICKED_UP → DELIVERED → COMPLETED. Disputes can be raised within 24h of delivery.

If you cannot answer confidently, or the user clearly wants a real person, say a team member will reach out and end with the token [[HUMAN]] on its own line.`

// ─── Types ───────────────────────────────────────────────────────────────────
type Role = 'customer' | 'vendor' | 'rider' | 'unknown'

type CartItem = { menu_item_id: string; name: string; price_kobo: number; qty: number }
type Cart = { vendor_id?: string; vendor_name?: string; delivery_type?: 'BIKE' | 'DOOR'; items: CartItem[] }

type Conversation = {
  phone: string
  role: string | null
  state: string
  cart: Cart
  active_order_id: string | null
  mode: 'bot' | 'human'
}

/** Shape of one already-extracted inbound message (text or interactive reply). */
export type InboundMessage = {
  waMessageId: string
  from: string // E.164 without + (as WhatsApp sends it)
  /** Free text, when type==='text'. */
  text?: string
  /** Selected reply id, when the user tapped a button/list row. */
  replyId?: string
  /** Raw message type for logging. */
  rawType: string
  /** WhatsApp profile name, if present in the webhook contacts. */
  profileName?: string
  /** Raw message object, for the log. */
  raw: unknown
}

type DB = SupabaseClient

/** Canonicalize a WhatsApp-supplied number (e.g. "2348012345678") to +E.164. */
export function canonicalPhone(from: string): string {
  return safeNormalizePhone(from) ?? `+${from.replace(/[^\d]/g, '')}`
}

// ─── Conversation persistence ────────────────────────────────────────────────
const EMPTY_CART: Cart = { items: [] }

async function getConversation(db: DB, phone: string): Promise<Conversation> {
  const { data } = await db
    .from('whatsapp_conversations')
    .select('phone, role, state, cart, active_order_id, mode')
    .eq('phone', phone)
    .maybeSingle()
  if (data) {
    return {
      phone: data.phone,
      role: data.role,
      state: data.state,
      cart: (data.cart as Cart) ?? EMPTY_CART,
      active_order_id: data.active_order_id,
      mode: (data.mode as 'bot' | 'human') ?? 'bot',
    }
  }
  // First contact — create the row so state persists from message one.
  await db.from('whatsapp_conversations').insert({ phone, state: 'IDLE', cart: EMPTY_CART }).then(() => {}, () => {})
  return { phone, role: null, state: 'IDLE', cart: EMPTY_CART, active_order_id: null, mode: 'bot' }
}

async function patchConversation(db: DB, phone: string, patch: Partial<Conversation>): Promise<void> {
  await db
    .from('whatsapp_conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('phone', phone)
}

async function logMessage(
  db: DB,
  row: { phone: string; direction: 'in' | 'out'; waMessageId?: string | null; type?: string; body?: string; payload?: unknown },
): Promise<void> {
  await db
    .from('whatsapp_messages')
    .insert({
      phone: row.phone,
      direction: row.direction,
      wa_message_id: row.waMessageId ?? null,
      msg_type: row.type ?? null,
      body: row.body ?? null,
      payload: (row.payload as object) ?? null,
    })
    .then(() => {}, () => {})
}

/**
 * Insert the inbound message as the DEDUPE GATE. The partial unique index on
 * whatsapp_messages(wa_message_id) WHERE direction='in' makes Meta's retries
 * collide → returns false the second time so the caller skips reprocessing.
 * Returns true only for a genuinely first-seen message.
 */
export async function logInboundOnce(msg: InboundMessage): Promise<boolean> {
  const db = createSupabaseAdmin()
  const phone = canonicalPhone(msg.from)
  const { error } = await db.from('whatsapp_messages').insert({
    phone,
    direction: 'in',
    wa_message_id: msg.waMessageId,
    msg_type: msg.rawType,
    body: msg.text ?? msg.replyId ?? '',
    payload: (msg.raw as object) ?? null,
  })
  if (error) {
    // 23505 = unique violation → already processed this Meta message id.
    if (error.code === '23505') return false
    // Any other insert error: don't drop the message — process it anyway.
    return true
  }
  return true
}

// Outbound helpers that also write to the message log so the admin inbox shows a
// complete thread (bot replies included).
async function outText(db: DB, to: string, body: string): Promise<void> {
  await sendText(to, body)
  await logMessage(db, { phone: to, direction: 'out', type: 'text', body })
}
async function outButtons(db: DB, to: string, body: string, buttons: { id: string; title: string }[], header?: string): Promise<void> {
  await sendButtons(to, body, buttons, header)
  await logMessage(db, { phone: to, direction: 'out', type: 'interactive', body })
}
async function outList(db: DB, to: string, body: string, label: string, rows: WARow[], sectionTitle?: string): Promise<void> {
  await sendList(to, body, label, rows, sectionTitle)
  await logMessage(db, { phone: to, direction: 'out', type: 'interactive', body })
}

// ─── Pricing (read from settings, with locked-default fallbacks) ──────────────
async function loadPricing(db: DB) {
  const ids = ['platform_markup', 'delivery_fee_bike', 'delivery_fee_door', 'rider_delivery_cut_bike', 'rider_delivery_cut_door', 'min_order_amount']
  const { data } = await db.from('settings').select('id, value').in('id', ids)
  const map = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>) {
    const n = Number(r.value?.amount_kobo)
    if (Number.isFinite(n)) map.set(r.id, n)
  }
  const kobo = (id: string, fb: number) => map.get(id) ?? fb
  return {
    platformMarkup: kobo('platform_markup', 25000),
    bikeFee: kobo('delivery_fee_bike', 50000),
    doorFee: kobo('delivery_fee_door', 100000),
    riderCutBike: kobo('rider_delivery_cut_bike', 40000),
    riderCutDoor: kobo('rider_delivery_cut_door', 80000),
    minOrder: kobo('min_order_amount', 50000),
  }
}

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`

// ─── Public entry point ──────────────────────────────────────────────────────
/**
 * Handle one already-extracted inbound message. Caller (the webhook) is
 * responsible for signature verification and inbound dedupe BEFORE calling this.
 */
export async function handleInbound(msg: InboundMessage): Promise<void> {
  const db = createSupabaseAdmin()

  // Canonicalize the phone ONCE (WhatsApp sends 2348... with no +). Every lookup
  // uses this exact form — the #1 silent bug is mixing formats.
  // NOTE: the inbound message is logged + deduped by the webhook route BEFORE we
  // get here (the unique index on wa_message_id is the dedupe gate), so we do not
  // log it again here.
  const phone = canonicalPhone(msg.from)

  const conv = await getConversation(db, phone)

  // (a) Human mode → do not auto-reply; the message is already logged for the inbox.
  if (conv.mode === 'human') return

  // (b) Resolve role against the real tables.
  const detected = await detectRole(phone)
  const role: Role = (detected?.role === 'super_admin' || detected?.role === 'admin' ? 'customer' : detected?.role) ?? 'unknown'
  if (conv.role !== role) await patchConversation(db, phone, { role })

  const input = (msg.replyId ?? msg.text ?? '').trim()
  const lower = input.toLowerCase()

  // Global reset words always return to the menu (escape hatch from any state).
  if (['menu', 'hi', 'hello', 'start', 'restart', 'cancel', 'stop'].includes(lower)) {
    await resetToMenu(db, phone, role)
    return
  }

  // (c) Route by role.
  if (role === 'vendor' || role === 'rider') {
    await handleStaffFaq(db, phone, role, input)
    return
  }

  // customer OR unknown → ordering / menu / Q&A state machine.
  await handleCustomerFlow(db, phone, conv, role, msg, input)
}

// ─── Menu / reset ────────────────────────────────────────────────────────────
async function resetToMenu(db: DB, phone: string, role: Role): Promise<void> {
  await patchConversation(db, phone, { state: 'MENU', cart: EMPTY_CART })
  const rows: WARow[] = [
    { id: 'menu:order', title: '🍛 Order food', description: 'Browse open vendors and order' },
    { id: 'menu:vendor', title: '🏪 Become a vendor', description: 'Sell your food on LumeX' },
    { id: 'menu:rider', title: '🏍️ Become a rider', description: 'Earn delivering orders' },
    { id: 'menu:ask', title: '💬 Ask a question', description: 'Chat with our assistant' },
  ]
  const greeting = role === 'customer' ? 'Welcome back to LumeX Fud 👋' : 'Welcome to LumeX Fud 👋 — campus life, simplified.'
  await outList(db, phone, `${greeting}\n\nWhat would you like to do?`, 'Choose', rows, 'Main menu')
}

// ─── Staff FAQ (vendor / rider) via Llama, with human handoff ────────────────
async function handleStaffFaq(db: DB, phone: string, role: Role, input: string): Promise<void> {
  const wantsHuman = /\b(human|agent|person|support|representative|talk to|speak to|call me|chibuike|admin)\b/i.test(input)
  if (wantsHuman || !input) {
    await escalateToHuman(db, phone, role, input || '(requested a human)')
    return
  }

  if (!isLlamaConfigured()) {
    await escalateToHuman(db, phone, role, input)
    return
  }

  try {
    const answer = await askLlama([
      { role: 'system', content: FAQ_SYSTEM },
      { role: 'user', content: `A ${role} asks: ${input}` },
    ])
    if (answer.includes('[[HUMAN]]')) {
      const clean = answer.replace(/\[\[HUMAN\]\]/g, '').trim()
      if (clean) await outText(db, phone, clean)
      await escalateToHuman(db, phone, role, input)
      return
    }
    await outText(db, phone, answer || 'Sorry, I could not work that out — a team member will reach out shortly.')
  } catch {
    await escalateToHuman(db, phone, role, input)
  }
}

async function escalateToHuman(db: DB, phone: string, role: Role, lastMessage: string): Promise<void> {
  await patchConversation(db, phone, { mode: 'human' })
  await outText(db, phone, 'Got it 👍 A LumeX team member will reply here shortly. You can keep typing your question in the meantime.')
  // Notify the super admin out-of-band so they open the inbox.
  const adminPhone = safeNormalizePhone(process.env.SUPER_ADMIN_PHONE) || safeNormalizePhone(process.env.ADMIN_PHONE)
  if (adminPhone) {
    await sendText(
      adminPhone,
      `🔔 WhatsApp: a ${role} (${phone}) needs a human.\nLast message: "${lastMessage.slice(0, 200)}"\nReply in the inbox: ${APP_URL}/super-admin/whatsapp`,
    ).catch(() => {})
  }
}

// ─── Customer ordering state machine ─────────────────────────────────────────
async function handleCustomerFlow(
  db: DB,
  phone: string,
  conv: Conversation,
  role: Role,
  msg: InboundMessage,
  input: string,
): Promise<void> {
  // Menu selections are available from any state.
  if (input === 'menu:vendor' || input === 'menu:rider') {
    await captureApplication(db, phone, input === 'menu:vendor' ? 'vendor' : 'rider', msg.profileName)
    return
  }
  if (input === 'menu:ask') {
    await patchConversation(db, phone, { state: 'ASK' })
    await outText(db, phone, 'Sure — type your question and I’ll help. (Type "menu" anytime to go back.)')
    return
  }
  if (input === 'menu:order') {
    await startOrdering(db, phone)
    return
  }

  switch (conv.state) {
    case 'ASK':
      await answerQuestion(db, phone, input)
      return
    case 'CHOOSE_VENDOR':
      if (input.startsWith('vendor:')) {
        await chooseVendor(db, phone, conv, input.slice('vendor:'.length))
        return
      }
      break
    case 'CHOOSE_ITEM':
      if (input.startsWith('item:')) {
        await addItem(db, phone, conv, input.slice('item:'.length))
        return
      }
      if (input === 'cart:checkout') {
        await askDeliveryType(db, phone, conv)
        return
      }
      break
    case 'CART_REVIEW':
      if (input === 'cart:add') {
        await showMenu(db, phone, conv)
        return
      }
      if (input === 'cart:checkout') {
        await askDeliveryType(db, phone, conv)
        return
      }
      break
    case 'CHOOSE_DELIVERY':
      if (input === 'dt:BIKE' || input === 'dt:DOOR') {
        await setDeliveryType(db, phone, conv, input === 'dt:BIKE' ? 'BIKE' : 'DOOR')
        return
      }
      break
    case 'AWAIT_ADDRESS':
      // The ONE place we accept free text mid-order — a delivery address is a
      // string, not an intent to parse. Everything else is buttons/lists.
      if (msg.text && msg.text.trim().length >= 5) {
        await reviewOrder(db, phone, conv, msg.text.trim())
        return
      }
      await outText(db, phone, 'Please type your delivery address (lodge/hostel, block & room, and a landmark) — at least a few words.')
      return
    case 'CONFIRM':
      if (input === 'confirm:yes') {
        await placeOrder(db, phone, conv, msg.waMessageId)
        return
      }
      if (input === 'confirm:no') {
        await resetToMenu(db, phone, role)
        return
      }
      break
    default:
      break
  }

  // Anything unexpected → re-show the menu (keeps the user on rails).
  await resetToMenu(db, phone, role)
}

async function answerQuestion(db: DB, phone: string, input: string): Promise<void> {
  if (!isLlamaConfigured()) {
    await patchConversation(db, phone, { state: 'IDLE' })
    await escalateToHuman(db, phone, 'customer', input)
    return
  }
  try {
    const answer = await askLlama([
      { role: 'system', content: FAQ_SYSTEM },
      { role: 'user', content: `A customer asks: ${input}` },
    ])
    if (answer.includes('[[HUMAN]]')) {
      const clean = answer.replace(/\[\[HUMAN\]\]/g, '').trim()
      if (clean) await outText(db, phone, clean)
      await patchConversation(db, phone, { state: 'IDLE' })
      await escalateToHuman(db, phone, 'customer', input)
      return
    }
    await outText(db, phone, `${answer}\n\nType "menu" to order or do something else.`)
  } catch {
    await patchConversation(db, phone, { state: 'IDLE' })
    await escalateToHuman(db, phone, 'customer', input)
  }
}

async function startOrdering(db: DB, phone: string): Promise<void> {
  const { data: vendors } = await db
    .from('vendors')
    .select('id, shop_name, category')
    .eq('status', 'OPEN')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('shop_name')
    .limit(10)

  if (!vendors || vendors.length === 0) {
    await outText(db, phone, 'No vendors are open right now. Our hours are 7am–10pm — please check back soon. 🙏')
    await patchConversation(db, phone, { state: 'IDLE', cart: EMPTY_CART })
    return
  }

  const rows: WARow[] = vendors.map((v: { id: string; shop_name: string; category: string }) => ({
    id: `vendor:${v.id}`,
    title: v.shop_name,
    description: v.category,
  }))
  await patchConversation(db, phone, { state: 'CHOOSE_VENDOR', cart: EMPTY_CART })
  await outList(db, phone, 'Here are the vendors open now. Pick one to see their menu:', 'Vendors', rows, 'Open now')
}

async function chooseVendor(db: DB, phone: string, conv: Conversation, vendorId: string): Promise<void> {
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, status, is_active')
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vendor || !vendor.is_active || vendor.status !== 'OPEN') {
    await outText(db, phone, 'Sorry, that vendor just became unavailable. Let’s pick another.')
    await startOrdering(db, phone)
    return
  }
  const cart: Cart = { vendor_id: vendor.id, vendor_name: vendor.shop_name, items: [] }
  await patchConversation(db, phone, { cart })
  await showMenu(db, phone, { ...conv, cart })
}

async function showMenu(db: DB, phone: string, conv: Conversation): Promise<void> {
  const vendorId = conv.cart.vendor_id
  if (!vendorId) {
    await startOrdering(db, phone)
    return
  }
  const { data: items } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available')
    .eq('vendor_id', vendorId)
    .eq('is_available', true)
    .is('deleted_at', null)
    .order('display_order')
    .limit(10)

  if (!items || items.length === 0) {
    await outText(db, phone, 'This vendor has no items available right now. Let’s pick another vendor.')
    await startOrdering(db, phone)
    return
  }
  const rows: WARow[] = items.map((m: { id: string; name: string; price_kobo: number }) => ({
    id: `item:${m.id}`,
    title: m.name,
    description: naira(m.price_kobo),
  }))
  await patchConversation(db, phone, { state: 'CHOOSE_ITEM' })
  await outList(db, phone, `${conv.cart.vendor_name} — tap an item to add it to your order:`, 'Menu', rows, 'Menu')
}

async function addItem(db: DB, phone: string, conv: Conversation, menuItemId: string): Promise<void> {
  // Re-fetch the item to snapshot a trusted price (never trust the client).
  const { data: item } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available, vendor_id')
    .eq('id', menuItemId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!item || !item.is_available || item.vendor_id !== conv.cart.vendor_id) {
    await outText(db, phone, 'That item is no longer available. Pick another from the menu.')
    await showMenu(db, phone, conv)
    return
  }

  const items = [...conv.cart.items]
  const existing = items.find((i) => i.menu_item_id === item.id)
  if (existing) existing.qty += 1
  else items.push({ menu_item_id: item.id, name: item.name, price_kobo: item.price_kobo, qty: 1 })
  const cart: Cart = { ...conv.cart, items }
  await patchConversation(db, phone, { cart, state: 'CART_REVIEW' })

  const subtotal = items.reduce((s, i) => s + i.price_kobo * i.qty, 0)
  const lines = items.map((i) => `• ${i.qty}× ${i.name} — ${naira(i.price_kobo * i.qty)}`).join('\n')
  await outButtons(
    db,
    phone,
    `Added ✅\n\nYour cart (${conv.cart.vendor_name}):\n${lines}\n\nSubtotal: ${naira(subtotal)}`,
    [
      { id: 'cart:add', title: '➕ Add more' },
      { id: 'cart:checkout', title: '✅ Checkout' },
      { id: 'menu', title: '✖️ Cancel' },
    ],
  )
}

async function askDeliveryType(db: DB, phone: string, conv: Conversation): Promise<void> {
  if (conv.cart.items.length === 0) {
    await outText(db, phone, 'Your cart is empty. Add an item first.')
    await showMenu(db, phone, conv)
    return
  }
  const p = await loadPricing(db)
  await patchConversation(db, phone, { state: 'CHOOSE_DELIVERY' })
  await outButtons(db, phone, 'How should we deliver your order?', [
    { id: 'dt:BIKE', title: `🏍️ Bike ${naira(p.bikeFee)}` },
    { id: 'dt:DOOR', title: `🚪 Door ${naira(p.doorFee)}` },
  ])
}

async function setDeliveryType(db: DB, phone: string, conv: Conversation, type: 'BIKE' | 'DOOR'): Promise<void> {
  const cart: Cart = { ...conv.cart, delivery_type: type }
  await patchConversation(db, phone, { cart, state: 'AWAIT_ADDRESS' })
  await outText(db, phone, 'Got it. Now type your *delivery address* — lodge/hostel name, block & room, and a nearby landmark.')
}

async function reviewOrder(db: DB, phone: string, conv: Conversation, address: string): Promise<void> {
  const cart = conv.cart
  const p = await loadPricing(db)
  const subtotal = cart.items.reduce((s, i) => s + i.price_kobo * i.qty, 0)
  if (subtotal < p.minOrder) {
    await outText(db, phone, `Minimum order is ${naira(p.minOrder)}. Please add a bit more.`)
    await showMenu(db, phone, conv)
    return
  }
  const deliveryFee = cart.delivery_type === 'DOOR' ? p.doorFee : p.bikeFee
  const total = subtotal + p.platformMarkup + deliveryFee
  // Stash the address inside the cart so placeOrder has it (no extra column).
  await patchConversation(db, phone, { cart: { ...cart, delivery_type: cart.delivery_type }, state: 'CONFIRM', active_order_id: null })
  await db
    .from('whatsapp_conversations')
    .update({ cart: { ...cart, address }, updated_at: new Date().toISOString() })
    .eq('phone', phone)

  const lines = cart.items.map((i) => `• ${i.qty}× ${i.name} — ${naira(i.price_kobo * i.qty)}`).join('\n')
  await outButtons(
    db,
    phone,
    `Please confirm your order:\n\n${cart.vendor_name}\n${lines}\n\nSubtotal: ${naira(subtotal)}\nPlatform fee: ${naira(p.platformMarkup)}\n${cart.delivery_type === 'DOOR' ? 'Door' : 'Bike'} delivery: ${naira(deliveryFee)}\n*Total: ${naira(total)}*\n\nDeliver to: ${address}\n\n💵 Pay the vendor directly on delivery/pickup (no card needed here).`,
    [
      { id: 'confirm:yes', title: '✅ Confirm order' },
      { id: 'confirm:no', title: '✖️ Cancel' },
    ],
  )
}

async function placeOrder(db: DB, phone: string, conv: Conversation, waMessageId: string): Promise<void> {
  // Re-read the conversation to get the stashed address (set in reviewOrder).
  const { data: fresh } = await db
    .from('whatsapp_conversations')
    .select('cart')
    .eq('phone', phone)
    .maybeSingle()
  const cart = ((fresh?.cart as (Cart & { address?: string })) ?? conv.cart) as Cart & { address?: string }

  if (!cart.vendor_id || cart.items.length === 0 || !cart.delivery_type || !cart.address) {
    await outText(db, phone, 'Something went wrong with your cart. Let’s start over.')
    await resetToMenu(db, phone, 'customer')
    return
  }

  // Ensure a customer row exists — the WhatsApp phone IS the identity (already
  // verified by Meta), so we provision a lightweight customer on first order.
  const canonical = normalizePhone(phone)
  await db.from('customers').insert({ phone: canonical }).then(() => {}, () => {})
  const { data: customer } = await db.from('customers').select('id, suspended_until, suspend_reason').eq('phone', canonical).maybeSingle()
  if (!customer) {
    await outText(db, phone, 'We couldn’t set up your account just now. Please try again shortly.')
    return
  }
  const suspendedUntil = (customer as { suspended_until?: string | null }).suspended_until
  if (suspendedUntil && new Date(suspendedUntil).getTime() > Date.now()) {
    const reason = (customer as { suspend_reason?: string | null }).suspend_reason
    await outText(db, phone, reason ? `Your account is suspended: ${reason}` : 'Your account is suspended. Please contact support.')
    return
  }

  // Validate the vendor is still open, and re-snapshot item prices server-side.
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, phone, status, is_active')
    .eq('id', cart.vendor_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vendor || !vendor.is_active || vendor.status !== 'OPEN') {
    await outText(db, phone, 'Sorry, that vendor just closed. Please start a new order.')
    await resetToMenu(db, phone, 'customer')
    return
  }

  const { data: menuRows } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available, vendor_id')
    .in('id', cart.items.map((i) => i.menu_item_id))
    .eq('vendor_id', cart.vendor_id)
    .is('deleted_at', null)
  const menuMap = new Map((menuRows ?? []).map((m: { id: string; name: string; price_kobo: number; is_available: boolean }) => [m.id, m]))
  for (const i of cart.items) {
    const m = menuMap.get(i.menu_item_id)
    if (!m || !m.is_available) {
      await outText(db, phone, `Sorry, "${i.name}" just sold out. Let’s rebuild your order.`)
      await showMenu(db, phone, { ...conv, cart })
      return
    }
  }

  const p = await loadPricing(db)
  const subtotal = cart.items.reduce((s, i) => s + (menuMap.get(i.menu_item_id)!.price_kobo) * i.qty, 0)
  if (subtotal < p.minOrder) {
    await outText(db, phone, `Minimum order is ${naira(p.minOrder)}. Please add more.`)
    await showMenu(db, phone, { ...conv, cart })
    return
  }
  const deliveryFee = cart.delivery_type === 'DOOR' ? p.doorFee : p.bikeFee
  const riderCut = cart.delivery_type === 'DOOR' ? p.riderCutDoor : p.riderCutBike
  const platformDeliveryCut = deliveryFee - riderCut
  const total = subtotal + p.platformMarkup + deliveryFee

  const orderNumber = await generateOrderNumber()
  // Manual-pilot: vendor collects payment directly (no Paystack split). Status
  // goes straight to PENDING (vendor must accept) — payment_status stays PENDING.
  // idempotency_key on the confirm message id dedupes a double-tapped confirm.
  const { data: order, error } = await db
    .from('orders')
    .insert({
      order_number: orderNumber,
      customer_id: customer.id,
      vendor_id: cart.vendor_id,
      status: 'PENDING',
      delivery_type: cart.delivery_type,
      delivery_address: cart.address,
      subtotal,
      platform_markup: p.platformMarkup,
      delivery_fee: deliveryFee,
      platform_delivery_cut: platformDeliveryCut,
      rider_delivery_cut: riderCut,
      tip_amount: 0,
      total_amount: total,
      paystack_reference: orderNumber, // synthetic; no Paystack txn for manual orders
      idempotency_key: `wa-${waMessageId}`,
      payment_status: 'PENDING',
      rider_payment_status: 'PENDING',
      payment_method: 'MANUAL',
      wallet_amount_kobo: 0,
    })
    .select('id, order_number')
    .single()

  if (error || !order) {
    // 23505 → duplicate confirm tap; the order already exists, treat as success.
    if (error?.code === '23505') {
      await outText(db, phone, 'Your order is already placed ✅ — the vendor has it.')
      await patchConversation(db, phone, { state: 'IDLE', cart: EMPTY_CART })
      return
    }
    await outText(db, phone, 'We couldn’t place your order just now. Please try again in a moment.')
    return
  }

  const orderItems = cart.items.map((i) => {
    const m = menuMap.get(i.menu_item_id)!
    return {
      order_id: order.id,
      menu_item_id: i.menu_item_id,
      name: m.name,
      price: m.price_kobo,
      quantity: i.qty,
      subtotal: m.price_kobo * i.qty,
    }
  })
  await db.from('order_items').insert(orderItems)

  await patchConversation(db, phone, { state: 'IDLE', cart: EMPTY_CART, active_order_id: order.id })

  // Confirm to the customer with a tracking link (the web app, where their phone
  // owns the session — no PIN in chat).
  await outText(
    db,
    phone,
    `🎉 Order ${order.order_number} placed!\n\n${vendor.shop_name} will confirm shortly. Total ${naira(total)} — pay the vendor directly.\n\nTrack it here: ${APP_URL}/order/${order.order_number}`,
  )

  // Notify the vendor on WhatsApp (best-effort; the order also shows in their dashboard).
  if (vendor.phone) {
    const lines = cart.items.map((i) => `• ${i.qty}× ${menuMap.get(i.menu_item_id)!.name}`).join('\n')
    await sendText(
      safeNormalizePhone(vendor.phone) ?? vendor.phone,
      `🆕 New LumeX order ${order.order_number}\n${lines}\n\n${cart.delivery_type === 'DOOR' ? 'Door' : 'Bike'} delivery to: ${cart.address}\nTotal ${naira(total)} (customer pays you directly).\n\nAccept it in your dashboard: ${APP_URL}/vendor-dashboard`,
    ).catch(() => {})
  }
}

// ─── Vendor / rider lead capture ─────────────────────────────────────────────
async function captureApplication(db: DB, phone: string, kind: 'vendor' | 'rider', profileName?: string): Promise<void> {
  await db
    .from('whatsapp_applications')
    .insert({ phone, kind, name: profileName ?? null, details: {} })
    .then(() => {}, () => {})
  await patchConversation(db, phone, { state: 'IDLE' })
  const what = kind === 'vendor' ? 'sell your food' : 'deliver orders'
  await outText(
    db,
    phone,
    `Awesome — thanks for your interest to ${what} on LumeX Fud! 🙌\n\nWe’ve saved your details and a team member will reach out to get you set up. You can also start your application now at ${APP_URL}/register.`,
  )
  // Hand the lead to the admin inbox + ping the super admin.
  await escalateLead(db, phone, kind)
}

async function escalateLead(db: DB, phone: string, kind: 'vendor' | 'rider'): Promise<void> {
  await patchConversation(db, phone, { mode: 'human' })
  const adminPhone = safeNormalizePhone(process.env.SUPER_ADMIN_PHONE) || safeNormalizePhone(process.env.ADMIN_PHONE)
  if (adminPhone) {
    await sendText(adminPhone, `🆕 WhatsApp ${kind} lead from ${phone}. Inbox: ${APP_URL}/super-admin/whatsapp`).catch(() => {})
  }
}
