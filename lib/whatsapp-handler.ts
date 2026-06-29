import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdmin } from './supabase/server'
import { normalizePhone, safeNormalizePhone } from './phone'
import { detectRole } from './session'
import { generateOrderNumber } from './order-number'
import { askLlama, isLlamaConfigured } from './llm'
import { kbSystemPrompt, isEscalation } from './whatsapp-kb'
import { composeDeliveryAddress } from './delivery-address'
import { sendText, sendButtons, sendList, type WARow } from './whatsapp'

// ─── The WhatsApp bot "brain" ────────────────────────────────────────────────
// Per inbound message:
//   (a) mode=human  → bot is SILENT for that conversation (admin owns it)
//   (b) explicit "talk to a human" (button/keyword) → immediate handoff
//   (c) else resolve the sender's role against the REAL tables, then route:
//       customer/unknown → identity + ordering/onboarding/Q&A state machine;
//       active vendor/rider → grounded AI FAQ with human escalation.
//
// HARD INVARIANTS (do not weaken):
//   • The LLM never writes state. ALL writes (identity, orders, applications)
//     are done by deterministic code in this file using the service-role client.
//   • The bot can create/extend a CUSTOMER (the phone is the Meta-verified
//     identity) but can NEVER write to the live `vendors`/`riders` tables — those
//     are admin-provisioned. Vendor/rider interest is captured as an APPLICATION.
//   • The phone IS the login. We never ask for / accept / log a PIN in chat;
//     anything sensitive becomes a link to the web app.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lumexfud.com.ng'

// ─── Types ───────────────────────────────────────────────────────────────────
type Role = 'customer' | 'vendor' | 'rider' | 'unknown'

type CartItem = { menu_item_id: string; name: string; price_kobo: number; qty: number }
type AddrParts = { lodge?: string; block?: string; room?: string; lat?: number; lng?: number }
type Apply = { kind: 'vendor' | 'rider'; business?: string; name?: string; area?: string }

// `cart` (a JSONB column) is the per-phone scratch bag. The ordering, onboarding,
// address-capture, and application sub-flows are mutually exclusive, so they
// share it safely; resetToMenu()/EMPTY_CART clears everything.
type Cart = {
  vendor_id?: string
  vendor_name?: string
  delivery_type?: 'BIKE' | 'DOOR'
  items: CartItem[]
  address?: string // composed delivery_address string for placeOrder
  addr?: AddrParts // structured parts → orders.delivery_lodge/block/room
  addrPurpose?: 'order' | 'onboard' // where the address capture should return to
  next?: 'order' | 'reorder' // action to run after onboarding completes
  apply?: Apply
  skipped?: string[] // reorder: items dropped because unavailable
}

type Conversation = {
  phone: string
  role: string | null
  state: string
  cart: Cart
  active_order_id: string | null
  mode: 'bot' | 'human'
}

/** Shape of one already-extracted inbound message (text / reply / location). */
export type InboundMessage = {
  waMessageId: string
  from: string // E.164 without + (as WhatsApp sends it)
  text?: string
  replyId?: string // selected button/list row id
  location?: { latitude: number; longitude: number } // shared location pin
  rawType: string
  profileName?: string
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
  await db.from('whatsapp_conversations').insert({ phone, state: 'IDLE', cart: EMPTY_CART }).then(() => {}, () => {})
  return { phone, role: null, state: 'IDLE', cart: EMPTY_CART, active_order_id: null, mode: 'bot' }
}

async function patchConversation(db: DB, phone: string, patch: Partial<Conversation>): Promise<void> {
  await db
    .from('whatsapp_conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('phone', phone)
}

/** Persist just the cart (used a lot mid-flow). */
async function saveCart(db: DB, phone: string, cart: Cart, state?: string): Promise<void> {
  const patch: Record<string, unknown> = { cart, updated_at: new Date().toISOString() }
  if (state) patch.state = state
  await db.from('whatsapp_conversations').update(patch).eq('phone', phone)
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
 */
export async function logInboundOnce(msg: InboundMessage): Promise<boolean> {
  const db = createSupabaseAdmin()
  const phone = canonicalPhone(msg.from)
  const { error } = await db.from('whatsapp_messages').insert({
    phone,
    direction: 'in',
    wa_message_id: msg.waMessageId,
    msg_type: msg.rawType,
    body: msg.text ?? msg.replyId ?? (msg.location ? '[location pin]' : ''),
    payload: (msg.raw as object) ?? null,
  })
  if (error) {
    if (error.code === '23505') return false // already processed this Meta id
    return true // other error: don't drop the message
  }
  return true
}

// Outbound helpers that ALSO write to the message log so the admin inbox thread
// is complete (bot replies included).
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

// ─── Pricing (from settings, with locked-default fallbacks) ───────────────────
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

function feesText(p: Awaited<ReturnType<typeof loadPricing>>): string {
  return [
    `- Platform service fee: ${naira(p.platformMarkup)} per order`,
    `- Bike delivery: ${naira(p.bikeFee)}`,
    `- Door delivery: ${naira(p.doorFee)}`,
    `- Minimum order: ${naira(p.minOrder)}`,
  ].join('\n')
}

// ─── Identity helpers ─────────────────────────────────────────────────────────
type CustomerRow = { id: string; name: string | null; default_delivery_address: string | null; suspended_until: string | null; suspend_reason: string | null }

async function resolveCustomer(db: DB, phone: string): Promise<CustomerRow | null> {
  const canonical = normalizePhone(phone)
  const { data } = await db
    .from('customers')
    .select('id, name, default_delivery_address, suspended_until, suspend_reason')
    .eq('phone', canonical)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as CustomerRow) ?? null
}

/** Provision a customer row if missing (the phone is the Meta-verified identity). */
async function ensureCustomer(db: DB, phone: string): Promise<CustomerRow | null> {
  const existing = await resolveCustomer(db, phone)
  if (existing) return existing
  const canonical = normalizePhone(phone)
  await db.from('customers').insert({ phone: canonical }).then(() => {}, () => {})
  return resolveCustomer(db, phone)
}

async function hasRecentOrder(db: DB, customerId: string): Promise<boolean> {
  const { data } = await db
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', ['DELIVERED', 'COMPLETED'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return !!data
}

// ─── Public entry point ──────────────────────────────────────────────────────
export async function handleInbound(msg: InboundMessage): Promise<void> {
  const db = createSupabaseAdmin()
  const phone = canonicalPhone(msg.from)
  const conv = await getConversation(db, phone)

  // (a) Human mode → bot is fully silent (the message is already logged).
  if (conv.mode === 'human') return

  // Resolve role against the real tables. Staff (admin/super) chat as customers.
  const detected = await detectRole(phone)
  const role: Role = (detected?.role === 'super_admin' || detected?.role === 'admin' ? 'customer' : detected?.role) ?? 'unknown'
  if (conv.role !== role) await patchConversation(db, phone, { role })

  const input = (msg.replyId ?? msg.text ?? '').trim()
  const lower = input.toLowerCase()

  // (b) Explicit human request — button or keyword — fires from ANY state, with
  // no extra bot chatter beyond the single "connecting you" line.
  const HUMAN_RE = /\b(human|agent|admin|representative|real person|customer care|talk to (a|someone|somebody|support)|speak to (a|someone|somebody|support))\b/i
  if (input === 'menu:human' || HUMAN_RE.test(lower)) {
    await handoffToHuman(db, phone, role, 'explicit request', input || '(tapped Talk to a human)')
    return
  }

  // Global reset words → menu (escape hatch from any state).
  if (['menu', 'hi', 'hello', 'start', 'restart', 'cancel'].includes(lower)) {
    await resetToMenu(db, phone, role)
    return
  }

  if (role === 'vendor' || role === 'rider') {
    await handleStaffFaq(db, phone, role, input)
    return
  }

  await handleCustomerFlow(db, phone, conv, role, msg, input)
}

// ─── Menu / reset ────────────────────────────────────────────────────────────
async function resetToMenu(db: DB, phone: string, role: Role): Promise<void> {
  await patchConversation(db, phone, { state: 'MENU', cart: EMPTY_CART })

  const customer = await resolveCustomer(db, phone)
  const knownName = customer?.name?.trim()
  const canReorder = customer ? await hasRecentOrder(db, customer.id) : false

  const rows: WARow[] = [{ id: 'menu:order', title: '🍛 Order food', description: 'Browse open vendors and order' }]
  if (canReorder) rows.push({ id: 'menu:reorder', title: '🔁 Reorder last', description: 'Repeat your last meal' })
  rows.push(
    { id: 'menu:ask', title: '💬 Ask a question', description: 'How LumeX works, fees, etc.' },
    { id: 'menu:human', title: '🧑‍💼 Talk to a human', description: 'Reach the LumeX team' },
    { id: 'menu:vendor', title: '🏪 Become a vendor', description: 'Apply to sell your food' },
    { id: 'menu:rider', title: '🏍️ Become a rider', description: 'Apply to deliver orders' },
  )
  const greeting = knownName
    ? `Welcome back, ${knownName} 👋`
    : role === 'customer'
      ? 'Welcome back to LumeX Fud 👋'
      : 'Welcome to LumeX Fud 👋 — campus life, simplified.'
  await outList(db, phone, `${greeting}\n\nWhat would you like to do?`, 'Choose', rows, 'Main menu')
}

// ─── Grounded AI: staff FAQ + customer Q&A ───────────────────────────────────
async function answerWithAI(db: DB, phone: string, audience: Role, input: string): Promise<'answered' | 'escalate'> {
  if (!isLlamaConfigured() || audience === 'unknown' || !input) return 'escalate'
  const p = await loadPricing(db)
  try {
    const answer = await askLlama([
      { role: 'system', content: kbSystemPrompt(audience, feesText(p)) },
      { role: 'user', content: input },
    ])
    if (isEscalation(answer)) return 'escalate'
    await outText(db, phone, answer)
    return 'answered'
  } catch {
    return 'escalate'
  }
}

async function handleStaffFaq(db: DB, phone: string, role: Role, input: string): Promise<void> {
  const result = await answerWithAI(db, phone, role, input)
  if (result === 'escalate') {
    await handoffToHuman(db, phone, role, 'AI could not answer from verified knowledge', input || '(no question)')
  }
}

// ─── Human handoff (unified) ─────────────────────────────────────────────────
// Sets mode=human (bot goes silent), tells the customer clearly, and pings the
// admin out-of-band. The FULL context package (profile + order/cart + transcript)
// is assembled on read by the admin inbox — see app/api/admin/whatsapp/route.ts.
async function handoffToHuman(db: DB, phone: string, role: Role, reason: string, lastMessage: string): Promise<void> {
  await patchConversation(db, phone, { mode: 'human' })
  await outText(
    db,
    phone,
    '🤝 Connecting you to the LumeX team — a human will reply right here shortly. You can keep typing; they’ll see everything.',
  )
  const adminPhone = safeNormalizePhone(process.env.SUPER_ADMIN_PHONE) || safeNormalizePhone(process.env.ADMIN_PHONE)
  if (adminPhone) {
    await sendText(
      adminPhone,
      `🔔 WhatsApp handoff (${role}) ${phone}\nReason: ${reason}\nLast: "${lastMessage.slice(0, 180)}"\nInbox: ${APP_URL}/super-admin/whatsapp`,
    ).catch(() => {})
  }
}

// ─── Customer flow dispatcher ─────────────────────────────────────────────────
async function handleCustomerFlow(db: DB, phone: string, conv: Conversation, role: Role, msg: InboundMessage, input: string): Promise<void> {
  // Top-level menu selections work from any state.
  if (input === 'menu:vendor' || input === 'menu:rider') {
    await startApplication(db, phone, input === 'menu:vendor' ? 'vendor' : 'rider', msg.profileName)
    return
  }
  if (input === 'menu:ask') {
    await patchConversation(db, phone, { state: 'ASK' })
    await outText(db, phone, 'Sure — ask me anything about LumeX (how it works, fees, delivery, becoming a vendor…). Type "menu" to go back.')
    return
  }
  if (input === 'menu:order') {
    await ensureOnboardedThen(db, phone, 'order')
    return
  }
  if (input === 'menu:reorder') {
    await ensureOnboardedThen(db, phone, 'reorder')
    return
  }

  // A shared location pin is meaningful during address capture / onboarding.
  if (msg.location && conv.state.startsWith('ADDR_')) {
    await finishAddress(db, phone, conv, 'Shared location pin 📍', { lat: msg.location.latitude, lng: msg.location.longitude })
    return
  }

  switch (conv.state) {
    case 'ASK': {
      const r = await answerWithAI(db, phone, 'customer', input)
      if (r === 'escalate') await handoffToHuman(db, phone, 'customer', 'AI could not answer from verified knowledge', input)
      else await outText(db, phone, 'Anything else? Type "menu" to order or do something else.')
      return
    }

    // Onboarding ----------------------------------------------------------------
    case 'ONBOARD_NAME':
      if (msg.text && msg.text.trim().length >= 2) {
        await saveOnboardName(db, phone, conv, msg.text.trim())
        return
      }
      await outText(db, phone, 'What name should we put on your orders? (Just your first name is fine.)')
      return

    // Address capture (used by both checkout and onboarding) --------------------
    case 'ADDR_CHOICE':
      if (input === 'addr:use') return finishAddress(db, phone, conv, conv.cart.address ?? '')
      if (input === 'addr:lodge') return showLodgePicker(db, phone, conv)
      if (input === 'addr:type') {
        await saveCart(db, phone, conv.cart, 'AWAIT_ADDRESS')
        await outText(db, phone, 'Okay — type your delivery address (lodge/hostel, block & room, and a landmark).')
        return
      }
      break
    case 'ADDR_LODGE':
      if (input.startsWith('lodge:')) return chooseLodge(db, phone, conv, input.slice('lodge:'.length))
      break
    case 'ADDR_BLOCK':
      if (input.startsWith('block:')) return chooseBlock(db, phone, conv, decodeURIComponent(input.slice('block:'.length)))
      break
    case 'ADDR_ROOM': {
      const room = input.toLowerCase() === 'skip' ? '' : (msg.text ?? '').trim()
      return finishLodgeAddress(db, phone, conv, room)
    }
    case 'AWAIT_ADDRESS':
      if (msg.text && msg.text.trim().length >= 5) return finishAddress(db, phone, conv, msg.text.trim())
      await outText(db, phone, 'Please type your delivery address — at least a few words (lodge, block/room, landmark).')
      return

    // Ordering ------------------------------------------------------------------
    case 'CHOOSE_VENDOR':
      if (input.startsWith('vendor:')) return chooseVendor(db, phone, conv, input.slice('vendor:'.length))
      break
    case 'CHOOSE_ITEM':
      if (input.startsWith('item:')) return addItem(db, phone, conv, input.slice('item:'.length))
      if (input === 'cart:checkout') return askDeliveryType(db, phone, conv)
      break
    case 'CART_REVIEW':
      if (input === 'cart:add') return showMenu(db, phone, conv)
      if (input === 'cart:checkout') return askDeliveryType(db, phone, conv)
      break
    case 'CHOOSE_DELIVERY':
      if (input === 'dt:BIKE' || input === 'dt:DOOR') return setDeliveryType(db, phone, conv, input === 'dt:BIKE' ? 'BIKE' : 'DOOR')
      break
    case 'CONFIRM':
      if (input === 'confirm:yes') return placeOrder(db, phone, conv, msg.waMessageId)
      if (input === 'confirm:no') return resetToMenu(db, phone, role)
      break

    // Application ---------------------------------------------------------------
    case 'APPLY_BIZ':
      if (msg.text && msg.text.trim().length >= 2) return applyStepArea(db, phone, conv, msg.text.trim())
      await outText(db, phone, conv.cart.apply?.kind === 'vendor' ? 'What’s your food business / shop name?' : 'What’s your full name?')
      return
    case 'APPLY_AREA':
      if (msg.text && msg.text.trim().length >= 2) return saveApplication(db, phone, conv, msg.text.trim())
      await outText(db, phone, 'Which campus area/zone are you around? (e.g. a lodge name or landmark)')
      return

    default:
      break
  }

  // Anything unexpected → back to the menu (keeps the user on rails).
  await resetToMenu(db, phone, role)
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
async function ensureOnboardedThen(db: DB, phone: string, next: 'order' | 'reorder'): Promise<void> {
  const customer = await ensureCustomer(db, phone)
  if (customer?.name?.trim()) {
    // Known customer → run the action directly.
    if (next === 'reorder') return reorderLast(db, phone, customer)
    return startOrdering(db, phone)
  }
  // New customer → short onboarding (name, then delivery location), remembering
  // what they wanted so we resume it afterwards.
  await saveCart(db, phone, { items: [], next }, 'ONBOARD_NAME')
  await outText(db, phone, 'Welcome to LumeX Fud 👋 First time here — what name should we put on your orders?')
}

async function saveOnboardName(db: DB, phone: string, conv: Conversation, name: string): Promise<void> {
  const customer = await ensureCustomer(db, phone)
  if (customer) await db.from('customers').update({ name, updated_at: new Date().toISOString() }).eq('id', customer.id)
  // Now capture their usual delivery location, then resume the pending action.
  await startAddressCapture(db, phone, { ...conv.cart, addrPurpose: 'onboard' }, 'onboard', name)
}

// ─── Address capture (shared: onboarding + checkout) ──────────────────────────
async function startAddressCapture(db: DB, phone: string, cart: Cart, purpose: 'order' | 'onboard', name?: string): Promise<void> {
  const customer = await resolveCustomer(db, phone)
  const saved = customer?.default_delivery_address?.trim()
  const next: Cart = { ...cart, addrPurpose: purpose, address: purpose === 'order' ? cart.address : saved || undefined }

  const buttons: { id: string; title: string }[] = []
  // Offer the saved "usual" only at checkout (during onboarding they're setting it).
  if (purpose === 'order' && saved) {
    next.address = saved
    buttons.push({ id: 'addr:use', title: '📍 Use saved' })
  }
  buttons.push({ id: 'addr:lodge', title: '🏠 Pick lodge' }, { id: 'addr:type', title: '⌨️ Type address' })

  await saveCart(db, phone, next, 'ADDR_CHOICE')
  const intro =
    purpose === 'onboard'
      ? `Thanks${name ? `, ${name}` : ''}! Where should we deliver? Pick your lodge, type your address, or tap 📎 → Location to drop a pin.`
      : saved
        ? `Deliver to your usual?\n_${saved}_\n\nOr pick a lodge / type a new address (📎 → Location also works).`
        : 'Where should we deliver? Pick your lodge, type your address, or tap 📎 → Location to drop a pin.'
  await outButtons(db, phone, intro, buttons)
}

async function showLodgePicker(db: DB, phone: string, conv: Conversation): Promise<void> {
  const { data: lodges } = await db
    .from('lodges')
    .select('id, name, area, blocks')
    .eq('is_active', true)
    .order('name')
    .limit(10)
  if (!lodges || lodges.length === 0) {
    await saveCart(db, phone, conv.cart, 'AWAIT_ADDRESS')
    await outText(db, phone, 'No lodges listed yet — please type your delivery address (lodge, block/room, landmark).')
    return
  }
  const rows: WARow[] = lodges.map((l: { id: string; name: string; area: string | null }) => ({
    id: `lodge:${l.id}`,
    title: l.name,
    description: l.area ?? undefined,
  }))
  await saveCart(db, phone, conv.cart, 'ADDR_LODGE')
  await outList(db, phone, 'Pick your lodge:', 'Lodges', rows, 'ABSU lodges')
}

async function chooseLodge(db: DB, phone: string, conv: Conversation, lodgeId: string): Promise<void> {
  const { data: lodge } = await db.from('lodges').select('id, name, area, blocks').eq('id', lodgeId).maybeSingle()
  if (!lodge) {
    await outText(db, phone, 'That lodge is no longer listed. Let’s try again.')
    return showLodgePicker(db, phone, conv)
  }
  const cart: Cart = { ...conv.cart, addr: { ...conv.cart.addr, lodge: lodge.name } }
  const blocks: string[] = Array.isArray(lodge.blocks) ? lodge.blocks : []
  if (blocks.length > 0) {
    const rows: WARow[] = blocks.slice(0, 10).map((b) => ({ id: `block:${encodeURIComponent(b)}`, title: b }))
    await saveCart(db, phone, cart, 'ADDR_BLOCK')
    await outList(db, phone, `${lodge.name} — pick your block:`, 'Blocks', rows, 'Blocks')
    return
  }
  // No blocks → ask room directly.
  await saveCart(db, phone, cart, 'ADDR_ROOM')
  await outText(db, phone, `${lodge.name} 👍 What’s your room number / extra directions? (Type it, or send "skip".)`)
}

async function chooseBlock(db: DB, phone: string, conv: Conversation, block: string): Promise<void> {
  const cart: Cart = { ...conv.cart, addr: { ...conv.cart.addr, block } }
  await saveCart(db, phone, cart, 'ADDR_ROOM')
  await outText(db, phone, `${block} 👍 What’s your room number / extra directions? (Type it, or send "skip".)`)
}

async function finishLodgeAddress(db: DB, phone: string, conv: Conversation, room: string): Promise<void> {
  const addr: AddrParts = { ...conv.cart.addr, room: room || undefined }
  // composeDeliveryAddress needs a delivery type; during onboarding (no type yet)
  // use DOOR so block+room are included in the saved string.
  const type = conv.cart.delivery_type ?? 'DOOR'
  const composed = composeDeliveryAddress(type, { lodge: addr.lodge ?? '', block: addr.block, room: addr.room })
  await finishAddress(db, phone, { ...conv, cart: { ...conv.cart, addr } }, composed, addr)
}

// Single funnel for a completed address (free-text, lodge-picked, or pinned).
async function finishAddress(db: DB, phone: string, conv: Conversation, address: string, parts?: AddrParts): Promise<void> {
  const addr: AddrParts = { ...conv.cart.addr, ...parts }
  const cart: Cart = { ...conv.cart, address, addr }
  const purpose = cart.addrPurpose ?? 'order'

  if (purpose === 'onboard') {
    // Persist the default for one-tap reuse next time, then resume the action.
    const customer = await resolveCustomer(db, phone)
    if (customer) {
      await db.from('customers').update({ default_delivery_address: address, updated_at: new Date().toISOString() }).eq('id', customer.id)
      // If a pin was shared, keep it as a "your usual" saved place (best-effort).
      if (parts?.lat != null && parts?.lng != null) {
        await db
          .from('saved_places')
          .insert({ customer_id: customer.id, label: 'Home', latitude: parts.lat, longitude: parts.lng, is_default: true })
          .then(() => {}, () => {})
      }
    }
    const next = cart.next
    await saveCart(db, phone, { items: [] }, 'IDLE')
    await outText(db, phone, `Saved your delivery spot ✅\n_${address}_`)
    if (next === 'reorder' && customer) return reorderLast(db, phone, customer)
    return startOrdering(db, phone)
  }

  // purpose === 'order' → straight to confirmation.
  await saveCart(db, phone, cart, 'CONFIRM')
  return reviewOrder(db, phone, { ...conv, cart })
}

// ─── Ordering ─────────────────────────────────────────────────────────────────
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
  const { data: vendor } = await db.from('vendors').select('id, shop_name, status, is_active').eq('id', vendorId).is('deleted_at', null).maybeSingle()
  if (!vendor || !vendor.is_active || vendor.status !== 'OPEN') {
    await outText(db, phone, 'Sorry, that vendor just became unavailable. Let’s pick another.')
    return startOrdering(db, phone)
  }
  const cart: Cart = { vendor_id: vendor.id, vendor_name: vendor.shop_name, items: [] }
  await saveCart(db, phone, cart)
  await showMenu(db, phone, { ...conv, cart })
}

async function showMenu(db: DB, phone: string, conv: Conversation): Promise<void> {
  const vendorId = conv.cart.vendor_id
  if (!vendorId) return startOrdering(db, phone)
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
    return startOrdering(db, phone)
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
  const { data: item } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available, vendor_id')
    .eq('id', menuItemId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!item || !item.is_available || item.vendor_id !== conv.cart.vendor_id) {
    await outText(db, phone, 'That item is no longer available. Pick another from the menu.')
    return showMenu(db, phone, conv)
  }
  const items = [...conv.cart.items]
  const existing = items.find((i) => i.menu_item_id === item.id)
  if (existing) existing.qty += 1
  else items.push({ menu_item_id: item.id, name: item.name, price_kobo: item.price_kobo, qty: 1 })
  const cart: Cart = { ...conv.cart, items }
  await saveCart(db, phone, cart, 'CART_REVIEW')

  const subtotal = items.reduce((s, i) => s + i.price_kobo * i.qty, 0)
  const lines = items.map((i) => `• ${i.qty}× ${i.name} — ${naira(i.price_kobo * i.qty)}`).join('\n')
  await outButtons(db, phone, `Added ✅\n\nYour cart (${conv.cart.vendor_name}):\n${lines}\n\nSubtotal: ${naira(subtotal)}`, [
    { id: 'cart:add', title: '➕ Add more' },
    { id: 'cart:checkout', title: '✅ Checkout' },
    { id: 'menu', title: '✖️ Cancel' },
  ])
}

async function askDeliveryType(db: DB, phone: string, conv: Conversation): Promise<void> {
  if (conv.cart.items.length === 0) {
    await outText(db, phone, 'Your cart is empty. Add an item first.')
    return showMenu(db, phone, conv)
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
  // Hand off to the shared address picker (offers saved address / lodge / type).
  await startAddressCapture(db, phone, { ...cart, addrPurpose: 'order' }, 'order')
}

async function reviewOrder(db: DB, phone: string, conv: Conversation): Promise<void> {
  const cart = conv.cart
  if (!cart.address) {
    await outText(db, phone, 'I didn’t catch your address. Let’s set it again.')
    return startAddressCapture(db, phone, cart, 'order')
  }
  const p = await loadPricing(db)
  const subtotal = cart.items.reduce((s, i) => s + i.price_kobo * i.qty, 0)
  if (subtotal < p.minOrder) {
    await outText(db, phone, `Minimum order is ${naira(p.minOrder)}. Please add a bit more.`)
    return showMenu(db, phone, conv)
  }
  const deliveryFee = cart.delivery_type === 'DOOR' ? p.doorFee : p.bikeFee
  const total = subtotal + p.platformMarkup + deliveryFee
  await saveCart(db, phone, cart, 'CONFIRM')

  const lines = cart.items.map((i) => `• ${i.qty}× ${i.name} — ${naira(i.price_kobo * i.qty)}`).join('\n')
  await outButtons(
    db,
    phone,
    `Please confirm your order:\n\n${cart.vendor_name}\n${lines}\n\nSubtotal: ${naira(subtotal)}\nPlatform fee: ${naira(p.platformMarkup)}\n${cart.delivery_type === 'DOOR' ? 'Door' : 'Bike'} delivery: ${naira(deliveryFee)}\n*Total: ${naira(total)}*\n\nDeliver to: ${cart.address}\n\n💵 Pay the vendor directly on delivery (no card needed here).`,
    [
      { id: 'confirm:yes', title: '✅ Confirm order' },
      { id: 'confirm:no', title: '✖️ Cancel' },
    ],
  )
}

async function reorderLast(db: DB, phone: string, customer: CustomerRow): Promise<void> {
  // Mirrors app/api/orders/[id]/reorder: rebuild from the last finished order,
  // re-validating the vendor is open + each item still available (trusted prices).
  const { data: last } = await db
    .from('orders')
    .select('id, vendor_id')
    .eq('customer_id', customer.id)
    .in('status', ['DELIVERED', 'COMPLETED'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last) {
    await outText(db, phone, 'You don’t have a past order to repeat yet. Let’s start a fresh one.')
    return startOrdering(db, phone)
  }
  const { data: vendor } = await db.from('vendors').select('id, shop_name, status, is_active').eq('id', last.vendor_id).is('deleted_at', null).maybeSingle()
  if (!vendor || !vendor.is_active || vendor.status !== 'OPEN') {
    await outText(db, phone, 'Your last vendor isn’t open right now. Let’s pick from who’s open.')
    return startOrdering(db, phone)
  }
  const { data: pastItems } = await db.from('order_items').select('menu_item_id, quantity').eq('order_id', last.id)
  const ids = (pastItems ?? []).map((i: { menu_item_id: string }) => i.menu_item_id).filter(Boolean)
  if (ids.length === 0) {
    await outText(db, phone, 'Couldn’t rebuild that order. Let’s start fresh.')
    return startOrdering(db, phone)
  }
  const { data: menuRows } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available')
    .in('id', ids)
    .eq('vendor_id', vendor.id)
    .is('deleted_at', null)
  const menuMap = new Map((menuRows ?? []).map((m: { id: string; name: string; price_kobo: number; is_available: boolean }) => [m.id, m]))

  const items: CartItem[] = []
  const skipped: string[] = []
  for (const it of pastItems as Array<{ menu_item_id: string; quantity: number }>) {
    const m = menuMap.get(it.menu_item_id)
    if (m && m.is_available) items.push({ menu_item_id: m.id, name: m.name, price_kobo: m.price_kobo, qty: it.quantity })
    else if (m) skipped.push(m.name)
  }
  if (items.length === 0) {
    await outText(db, phone, `Nothing from your last order at ${vendor.shop_name} is available right now. Let’s build a new one.`)
    return chooseVendor(db, phone, { phone, role: 'customer', state: 'CHOOSE_VENDOR', cart: { items: [] }, active_order_id: null, mode: 'bot' }, vendor.id)
  }
  const cart: Cart = { vendor_id: vendor.id, vendor_name: vendor.shop_name, items, skipped }
  await saveCart(db, phone, cart)
  const lines = items.map((i) => `• ${i.qty}× ${i.name} — ${naira(i.price_kobo * i.qty)}`).join('\n')
  const note = skipped.length ? `\n\n(Skipped, not available now: ${skipped.join(', ')})` : ''
  await outText(db, phone, `🔁 Rebuilt your last order from ${vendor.shop_name}:\n${lines}${note}`)
  await askDeliveryType(db, phone, { ...({ phone, role: 'customer', state: 'CART_REVIEW', active_order_id: null, mode: 'bot' } as Conversation), cart })
}

async function placeOrder(db: DB, phone: string, conv: Conversation, waMessageId: string): Promise<void> {
  const { data: fresh } = await db.from('whatsapp_conversations').select('cart').eq('phone', phone).maybeSingle()
  const cart = ((fresh?.cart as Cart) ?? conv.cart) as Cart

  if (!cart.vendor_id || cart.items.length === 0 || !cart.delivery_type || !cart.address) {
    await outText(db, phone, 'Something went wrong with your cart. Let’s start over.')
    return resetToMenu(db, phone, 'customer')
  }

  const customer = await ensureCustomer(db, phone)
  if (!customer) {
    await outText(db, phone, 'We couldn’t set up your account just now. Please try again shortly.')
    return
  }
  if (customer.suspended_until && new Date(customer.suspended_until).getTime() > Date.now()) {
    await outText(db, phone, customer.suspend_reason ? `Your account is suspended: ${customer.suspend_reason}` : 'Your account is suspended. Please contact support.')
    return
  }

  const { data: vendor } = await db.from('vendors').select('id, shop_name, phone, status, is_active').eq('id', cart.vendor_id).is('deleted_at', null).maybeSingle()
  if (!vendor || !vendor.is_active || vendor.status !== 'OPEN') {
    await outText(db, phone, 'Sorry, that vendor just closed. Please start a new order.')
    return resetToMenu(db, phone, 'customer')
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
      return showMenu(db, phone, { ...conv, cart })
    }
  }

  const p = await loadPricing(db)
  const subtotal = cart.items.reduce((s, i) => s + menuMap.get(i.menu_item_id)!.price_kobo * i.qty, 0)
  if (subtotal < p.minOrder) {
    await outText(db, phone, `Minimum order is ${naira(p.minOrder)}. Please add more.`)
    return showMenu(db, phone, { ...conv, cart })
  }
  const deliveryFee = cart.delivery_type === 'DOOR' ? p.doorFee : p.bikeFee
  const riderCut = cart.delivery_type === 'DOOR' ? p.riderCutDoor : p.riderCutBike
  const platformDeliveryCut = deliveryFee - riderCut
  const total = subtotal + p.platformMarkup + deliveryFee

  const orderNumber = await generateOrderNumber()
  // Manual-pilot order: vendor collects payment (no Paystack split). Straight to
  // PENDING (vendor must accept). idempotency_key dedupes a double-tapped confirm.
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
      paystack_reference: orderNumber,
      idempotency_key: `wa-${waMessageId}`,
      payment_status: 'PENDING',
      rider_payment_status: 'PENDING',
      payment_method: 'MANUAL',
      wallet_amount_kobo: 0,
    })
    .select('id, order_number')
    .single()

  if (error || !order) {
    if (error?.code === '23505') {
      await outText(db, phone, 'Your order is already placed ✅ — the vendor has it.')
      await patchConversation(db, phone, { state: 'IDLE', cart: EMPTY_CART })
      return
    }
    await outText(db, phone, 'We couldn’t place your order just now. Please try again in a moment.')
    return
  }

  await db.from('order_items').insert(
    cart.items.map((i) => {
      const m = menuMap.get(i.menu_item_id)!
      return { order_id: order.id, menu_item_id: i.menu_item_id, name: m.name, price: m.price_kobo, quantity: i.qty, subtotal: m.price_kobo * i.qty }
    }),
  )

  // Structured delivery columns (non-fatal — order already succeeded; safe if
  // migration 080 hasn't run). Reuses the same columns the web checkout writes.
  if (cart.addr && (cart.addr.lodge || cart.addr.block || cart.addr.room)) {
    db.from('orders')
      .update({ delivery_lodge: cart.addr.lodge ?? null, delivery_block: cart.addr.block ?? null, delivery_room: cart.addr.room ?? null })
      .eq('id', order.id)
      .then(() => {}, () => {})
  }
  // Remember the address for one-tap reuse + set it as the default if unset.
  db.rpc('remember_customer_address', { p_customer: customer.id, p_address: cart.address }).then(() => {}, () => {})
  if (!customer.default_delivery_address) {
    db.from('customers').update({ default_delivery_address: cart.address }).eq('id', customer.id).then(() => {}, () => {})
  }

  await patchConversation(db, phone, { state: 'IDLE', cart: EMPTY_CART, active_order_id: order.id })
  await outText(
    db,
    phone,
    `🎉 Order ${order.order_number} placed!\n\n${vendor.shop_name} will confirm shortly. Total ${naira(total)} — pay the vendor directly.\n\nTrack it here: ${APP_URL}/order/${order.order_number}`,
  )

  if (vendor.phone) {
    const lines = cart.items.map((i) => `• ${i.qty}× ${menuMap.get(i.menu_item_id)!.name}`).join('\n')
    await sendText(
      safeNormalizePhone(vendor.phone) ?? vendor.phone,
      `🆕 New LumeX order ${order.order_number}\n${lines}\n\n${cart.delivery_type === 'DOOR' ? 'Door' : 'Bike'} delivery to: ${cart.address}\nTotal ${naira(total)} (customer pays you directly).\n\nAccept it in your dashboard: ${APP_URL}/vendor-dashboard`,
    ).catch(() => {})
  }
}

// ─── Vendor / rider APPLICATION capture (NOT registration) ───────────────────
// BOUNDARY (do not change): this flow writes ONLY to `whatsapp_applications`. It
// NEVER inserts into `vendors`/`riders` and NEVER sets is_active or any access.
// An admin verifies the lead and provisions the real account via the dashboard
// (/admin/vendors/new, /admin/riders/new). The bot grants zero access.
async function startApplication(db: DB, phone: string, kind: 'vendor' | 'rider', profileName?: string): Promise<void> {
  await saveCart(db, phone, { items: [], apply: { kind, name: profileName } }, 'APPLY_BIZ')
  await outText(
    db,
    phone,
    kind === 'vendor'
      ? 'Great — let’s get your application started 🏪\n\nWhat’s your food business / shop name?'
      : 'Great — let’s get your application started 🏍️\n\nWhat’s your full name?',
  )
}

async function applyStepArea(db: DB, phone: string, conv: Conversation, answer: string): Promise<void> {
  const apply = conv.cart.apply ?? { kind: 'vendor' as const }
  if (apply.kind === 'vendor') apply.business = answer
  else apply.name = answer
  await saveCart(db, phone, { ...conv.cart, apply }, 'APPLY_AREA')
  await outText(db, phone, 'And which campus area/zone are you around? (e.g. a lodge name or landmark)')
}

async function saveApplication(db: DB, phone: string, conv: Conversation, area: string): Promise<void> {
  const apply = conv.cart.apply ?? { kind: 'vendor' as const }
  apply.area = area
  // The ONLY write: an application row. (Explicit boundary — see header above.)
  await db
    .from('whatsapp_applications')
    .insert({
      phone,
      kind: apply.kind,
      name: apply.name ?? null,
      details: { business: apply.business ?? null, area: apply.area ?? null, name: apply.name ?? null, source: 'whatsapp' },
    })
    .then(() => {}, () => {})

  // NOTE: we do NOT flip the conversation to mode=human here. The application is
  // captured + surfaced in the admin inbox (whatsapp_applications) and the admin
  // is pinged — but the applicant can keep using the bot (order food, ask, etc.)
  // instead of being trapped in a silent human-only thread.
  await patchConversation(db, phone, { state: 'IDLE', cart: EMPTY_CART })
  const what = apply.kind === 'vendor' ? 'sell your food' : 'deliver orders'
  await outText(
    db,
    phone,
    `Thank you! 🙌 Your application to ${what} on LumeX Fud is in. Our team will verify your details and set you up — we’ll reach out right here.\n\n(Reminder: accounts are activated by the LumeX team, not automatically.)\n\nMeanwhile you can still order food — just type "menu".`,
  )
  const adminPhone = safeNormalizePhone(process.env.SUPER_ADMIN_PHONE) || safeNormalizePhone(process.env.ADMIN_PHONE)
  if (adminPhone) {
    await sendText(
      adminPhone,
      `🆕 WhatsApp ${apply.kind} APPLICATION\nFrom: ${phone}\n${apply.kind === 'vendor' ? 'Business' : 'Name'}: ${apply.business ?? apply.name ?? '—'}\nArea: ${apply.area ?? '—'}\nVerify & provision in the dashboard. Inbox: ${APP_URL}/super-admin/whatsapp`,
    ).catch(() => {})
  }
}
