import 'server-only'

import type { createSupabaseAdmin } from './supabase/server'
import { normalizeEmail, sendEmail, type EmailSendResult } from './email/send-email'
import type { EmailWorkflow } from './email/identities'
import {
  isCustomerEmailStatus,
  renderDelayedOrderEmail,
  renderOrderConfirmationEmail,
  renderOrderStatusEmail,
  renderAccountNotificationEmail,
  renderWelcomeEmail,
} from './email-templates'

type DB = ReturnType<typeof createSupabaseAdmin>
type EmailKind = 'WELCOME' | 'ORDER_CONFIRMATION' | 'ORDER_OUT_FOR_DELIVERY' | 'ORDER_DELIVERED' | 'ORDER_DELAYED' | 'ORDER_STATUS' | 'ACCOUNT_NOTIFICATION'
export type TransactionalEmailResult = EmailSendResult | { status: 'skipped'; reason: 'already_processed' | 'no_recipient' | 'email_unverified' | 'irrelevant_status' | 'event_claim_failed' | 'order_not_found' }

type AccountRole = 'customer' | 'vendor' | 'rider'

export function shouldSendWelcomeForEmailChange(input: {
  previousEmail?: string | null
  nextEmail?: string | null
  welcomeEmailSentAt?: string | null
}): boolean {
  return !normalizeEmail(input.previousEmail) && !!normalizeEmail(input.nextEmail) && !input.welcomeEmailSentAt
}

function appBaseUrl(): string {
  const fallback = 'https://lumexfud.com.ng'
  try {
    const url = new URL(process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? fallback)
    const trusted = url.protocol === 'https:' && (url.hostname === 'lumexfud.com.ng' || url.hostname.endsWith('.lumexfud.com.ng'))
    return trusted ? url.origin : fallback
  } catch {
    return fallback
  }
}

async function claimEvent(db: DB, eventKey: string, kind: EmailKind, recipient: string): Promise<{ id: string; idempotencyKey: string } | 'processed' | 'failed'> {
  const { data, error } = await db.rpc('claim_transactional_email_event', {
    p_event_key: eventKey,
    p_kind: kind,
    p_recipient: recipient,
  })
  if (error) return 'failed'
  const row = (data as Array<{ event_id: string; claimed: boolean }> | null)?.[0]
  if (!row?.claimed) return 'processed'
  return { id: row.event_id, idempotencyKey: `${kind.toLowerCase()}/${row.event_id}` }
}

async function finishEvent(db: DB, eventId: string, result: EmailSendResult): Promise<void> {
  const status = result.status === 'sent' ? 'SENT' : result.status === 'failed' ? 'FAILED' : 'SKIPPED'
  await db.rpc('finish_transactional_email_event', {
    p_event_id: eventId,
    p_status: status,
    p_resend_id: result.providerMessageId,
    p_error_code: result.errorCode,
  })
}

async function deliver(db: DB, input: { eventKey: string; kind: EmailKind; workflow: EmailWorkflow; recipient: string; subject: string; text: string; html: string }): Promise<TransactionalEmailResult> {
  const recipient = normalizeEmail(input.recipient)
  if (!recipient) return { status: 'skipped', reason: 'no_recipient' }
  const claim = await claimEvent(db, input.eventKey, input.kind, recipient)
  if (claim === 'failed') return { status: 'skipped', reason: 'event_claim_failed' }
  if (claim === 'processed') return { status: 'skipped', reason: 'already_processed' }
  const result = await sendEmail({
    workflow: input.workflow,
    to: recipient,
    subject: input.subject,
    text: input.text,
    html: input.html,
    idempotencyKey: claim.idempotencyKey,
    eventId: claim.id,
  })
  await finishEvent(db, claim.id, result).catch(() => {})
  return result
}

async function sendWelcomeEmailInternal(db: DB, input: { customerId: string; email?: string | null; name?: string | null }): Promise<TransactionalEmailResult> {
  const { data: customer } = await db.from('customers').select('email_verified').eq('id', input.customerId).maybeSingle()
  if (customer?.email_verified !== true) return { status: 'skipped', reason: 'email_unverified' }
  const email = normalizeEmail(input.email)
  if (!email) return { status: 'skipped', reason: 'no_recipient' }
  const template = renderWelcomeEmail({ name: input.name, exploreUrl: appBaseUrl() })
  const result = await deliver(db, { eventKey: `welcome:${input.customerId}`, kind: 'WELCOME', workflow: 'customer_welcome', recipient: email, ...template })
  if (result.status === 'sent') {
    await db.from('customers').update({ welcome_email_sent_at: new Date().toISOString() }).eq('id', input.customerId).is('welcome_email_sent_at', null)
  }
  return result
}

async function sendOrderConfirmationEmailInternal(db: DB, input: { orderId: string }): Promise<TransactionalEmailResult> {
  const { data: order } = await db.from('orders').select('id, order_number, customer_id, vendor_id, subtotal, delivery_fee, platform_markup, tip_amount, reward_discount_kobo, total_amount, payment_status, delivery_type, delivery_address, delivery_lodge, delivery_block').eq('id', input.orderId).eq('payment_status', 'PAID').maybeSingle()
  if (!order?.customer_id) return { status: 'skipped', reason: 'order_not_found' }
  const [{ data: customer }, { data: vendor }, { data: items }] = await Promise.all([
    db.from('customers').select('email, name, email_verified').eq('id', order.customer_id).maybeSingle(),
    db.from('vendors').select('shop_name').eq('id', order.vendor_id).maybeSingle(),
    db.from('order_items').select('name, quantity, subtotal').eq('order_id', order.id),
  ])
  const recipient = normalizeEmail(customer?.email)
  if (!recipient) return { status: 'skipped', reason: 'no_recipient' }
  if (customer?.email_verified !== true) return { status: 'skipped', reason: 'email_unverified' }
  const vendorName = String(vendor?.shop_name ?? 'your vendor')
  const deliveryMethod = order.delivery_type === 'PICKUP' ? 'Campus pickup' : order.delivery_type === 'BIKE' ? 'Bike delivery' : 'Door delivery'
  const location = order.delivery_type === 'PICKUP'
    ? `Pickup at ${vendorName}`
    : [order.delivery_lodge, order.delivery_block].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ') || 'Your saved delivery location'
  const template = renderOrderConfirmationEmail({
    customerName: customer?.name,
    orderNumber: String(order.order_number),
    vendorName,
    items: (items ?? []).map((item) => ({ name: String(item.name), quantity: Number(item.quantity), subtotal: Number(item.subtotal) })),
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.delivery_fee),
    platformFee: Number(order.platform_markup),
    tip: Number(order.tip_amount ?? 0),
    discount: Number(order.reward_discount_kobo ?? 0),
    total: Number(order.total_amount),
    paymentStatus: 'Paid',
    deliveryMethod,
    deliveryLocation: location,
    orderUrl: `${appBaseUrl()}/order/${encodeURIComponent(String(order.order_number))}`,
  })
  return deliver(db, { eventKey: `order-confirmation:${order.id}`, kind: 'ORDER_CONFIRMATION', workflow: 'order_confirmation', recipient, ...template })
}

async function sendOrderStatusEmailInternal(db: DB, input: { orderId: string; newStatus: string; statusEventId: string }): Promise<TransactionalEmailResult> {
  if (!isCustomerEmailStatus(input.newStatus)) return { status: 'skipped', reason: 'irrelevant_status' }
  const { data: order } = await db.from('orders').select('id, order_number, customer_id, vendor_id').eq('id', input.orderId).maybeSingle()
  if (!order?.customer_id) return { status: 'skipped', reason: 'order_not_found' }
  const [{ data: customer }, { data: vendor }] = await Promise.all([
    db.from('customers').select('email, name, email_verified').eq('id', order.customer_id).maybeSingle(),
    db.from('vendors').select('shop_name').eq('id', order.vendor_id).maybeSingle(),
  ])
  const recipient = normalizeEmail(customer?.email)
  if (!recipient) return { status: 'skipped', reason: 'no_recipient' }
  if (customer?.email_verified !== true) return { status: 'skipped', reason: 'email_unverified' }
  const template = renderOrderStatusEmail({
    customerName: customer?.name,
    orderNumber: String(order.order_number),
    vendorName: vendor?.shop_name,
    status: input.newStatus,
    orderUrl: `${appBaseUrl()}/order/${encodeURIComponent(String(order.order_number))}`,
  })
  const notificationStatus = input.newStatus === 'COMPLETED' ? 'DELIVERED' : input.newStatus
  return deliver(db, {
    eventKey: `order-status:${input.orderId}:${notificationStatus}`,
    kind: 'ORDER_STATUS',
    workflow: 'delivery_status',
    recipient,
    ...template,
  })
}

async function sendDelayedOrderEmailInternal(db: DB, input: { orderId: string; projectedDeliveryAt?: string | null }): Promise<TransactionalEmailResult> {
  const { data: order } = await db.from('orders').select('id, order_number, customer_id, vendor_id').eq('id', input.orderId).maybeSingle()
  if (!order?.customer_id) return { status: 'skipped', reason: 'order_not_found' }
  const [{ data: customer }, { data: vendor }] = await Promise.all([
    db.from('customers').select('email, name, email_verified').eq('id', order.customer_id).maybeSingle(),
    db.from('vendors').select('shop_name').eq('id', order.vendor_id).maybeSingle(),
  ])
  const recipient = normalizeEmail(customer?.email)
  if (!recipient) return { status: 'skipped', reason: 'no_recipient' }
  if (customer?.email_verified !== true) return { status: 'skipped', reason: 'email_unverified' }
  const template = renderDelayedOrderEmail({
    customerName: customer?.name,
    orderNumber: String(order.order_number),
    vendorName: vendor?.shop_name,
    projectedDeliveryAt: input.projectedDeliveryAt,
    orderUrl: `${appBaseUrl()}/order/${encodeURIComponent(String(order.order_number))}`,
  })
  return deliver(db, { eventKey: `order-delayed:${order.id}`, kind: 'ORDER_DELAYED', workflow: 'delivery_status', recipient, ...template })
}

async function sendAccountNotificationEmailInternal(db: DB, input: {
  role: AccountRole
  accountId: string
  eventKey: string
  title: string
  body: string
  actionLabel: string
  actionUrl: string
}): Promise<TransactionalEmailResult> {
  const table = input.role === 'customer' ? 'customers' : input.role === 'vendor' ? 'vendors' : 'riders'
  const nameColumn = input.role === 'customer' ? 'name' : input.role === 'vendor' ? 'shop_name' : 'full_name'
  const { data } = await db.from(table).select(`email, email_verified, ${nameColumn}`).eq('id', input.accountId).maybeSingle()
  const row = data as { email?: string | null; email_verified?: boolean | null; name?: string | null; shop_name?: string | null; full_name?: string | null } | null
  const recipient = normalizeEmail(row?.email)
  if (!recipient) return { status: 'skipped', reason: 'no_recipient' }
  if (row?.email_verified !== true) return { status: 'skipped', reason: 'email_unverified' }
  const name = row?.name ?? row?.shop_name ?? row?.full_name ?? null
  const template = renderAccountNotificationEmail({ name, title: input.title, body: input.body, actionLabel: input.actionLabel, actionUrl: input.actionUrl })
  return deliver(db, { eventKey: input.eventKey, kind: 'ACCOUNT_NOTIFICATION', workflow: 'account_system', recipient, ...template })
}

export async function sendWelcomeEmail(db: DB, input: { customerId: string; email?: string | null; name?: string | null }): Promise<TransactionalEmailResult> {
  try {
    return await sendWelcomeEmailInternal(db, input)
  } catch {
    return { ok: false, status: 'failed', workflow: 'customer_welcome', providerMessageId: null, attempts: 0, errorCode: 'welcome_email_error', retryable: false }
  }
}

export async function sendOrderConfirmationEmail(db: DB, input: { orderId: string }): Promise<TransactionalEmailResult> {
  try {
    return await sendOrderConfirmationEmailInternal(db, input)
  } catch {
    return { ok: false, status: 'failed', workflow: 'order_confirmation', providerMessageId: null, attempts: 0, errorCode: 'order_confirmation_email_error', retryable: false }
  }
}

export async function sendOrderStatusEmail(db: DB, input: { orderId: string; newStatus: string; statusEventId: string }): Promise<TransactionalEmailResult> {
  try {
    return await sendOrderStatusEmailInternal(db, input)
  } catch {
    return { ok: false, status: 'failed', workflow: 'delivery_status', providerMessageId: null, attempts: 0, errorCode: 'order_status_email_error', retryable: false }
  }
}

export async function sendDelayedOrderEmail(db: DB, input: { orderId: string; projectedDeliveryAt?: string | null }): Promise<TransactionalEmailResult> {
  try {
    return await sendDelayedOrderEmailInternal(db, input)
  } catch {
    return { ok: false, status: 'failed', workflow: 'delivery_status', providerMessageId: null, attempts: 0, errorCode: 'order_delayed_email_error', retryable: false }
  }
}

/** Delivers a verified account's operational alert with durable event idempotency. */
export async function sendAccountNotificationEmail(db: DB, input: {
  role: AccountRole
  accountId: string
  eventKey: string
  title: string
  body: string
  actionLabel: string
  actionUrl: string
}): Promise<TransactionalEmailResult> {
  try {
    return await sendAccountNotificationEmailInternal(db, input)
  } catch {
    return { ok: false, status: 'failed', workflow: 'account_system', providerMessageId: null, attempts: 0, errorCode: 'account_notification_email_error', retryable: false }
  }
}
