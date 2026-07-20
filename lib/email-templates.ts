import { formatPrice } from './money'

const BRAND = '#F28C28'
const INK = '#241A12'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function firstName(name?: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function layout(preheader: string, body: string): string {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;background:#FFF8EF;color:${INK};font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF8EF"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border:1px solid #F3E4D2;border-radius:20px;overflow:hidden">
<tr><td style="padding:30px 30px 18px"><div style="font-size:22px;font-weight:800;letter-spacing:-.4px;color:${INK}">LumeX <span style="color:${BRAND}">Fud</span></div></td></tr>
<tr><td style="padding:0 30px 32px;font-size:16px;line-height:1.65">${body}</td></tr>
<tr><td style="padding:22px 30px;background:#FFF8EF;color:#806B58;font-size:12px;line-height:1.5">Made with care for campus life in Nigeria.</td></tr>
</table></td></tr></table></body></html>`
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px"><tr><td bgcolor="${BRAND}" style="border-radius:12px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;color:#FFFFFF;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></td></tr></table>`
}

export interface WelcomeTemplateInput { name?: string | null; exploreUrl: string }

export function renderWelcomeEmail(input: WelcomeTemplateInput) {
  const name = firstName(input.name)
  const subject = 'A warm welcome to LumeX Fud'
  const text = [
    `Hey ${name},`, '',
    'I’m glad you’re here.', '',
    'My name is Chibuike — I’m the founder of LumeX Fud.', '',
    'We built LumeX Fud to make finding good food around campus (and getting it delivered to you) feel much easier.', '',
    'Whenever you’re hungry, just open the app and see what’s nearby.', '',
    `→ Explore nearby food: ${input.exploreUrl}`, '',
    'P.S. What made you sign up? Just hit reply and let me know. I read every email.', '',
    'Cheers,', 'Chibuike', 'Founder, LumeX Fud',
  ].join('\n')
  const html = layout('A short welcome note from LumeX Fud.', `
    <p style="margin:0 0 16px">Hey ${escapeHtml(name)},</p>
    <p style="margin:0 0 16px">I’m glad you’re here.</p>
    <p style="margin:0 0 16px">My name is Chibuike — I’m the founder of LumeX Fud.</p>
    <p style="margin:0 0 16px">We built LumeX Fud to make finding good food around campus (and getting it delivered to you) feel much easier.</p>
    <p style="margin:0">Whenever you’re hungry, just open the app and see what’s nearby.</p>
    ${button('Explore nearby food', input.exploreUrl)}
    <p style="margin:24px 0 0">P.S. What made you sign up? Just hit reply and let me know. I read every email.</p>
    <p style="margin:24px 0 0">Cheers,<br><strong>Chibuike</strong><br>Founder, LumeX Fud</p>`)
  return { subject, text, html }
}

export interface OrderItemTemplate { name: string; quantity: number; subtotal: number }
export interface OrderConfirmationTemplateInput {
  customerName?: string | null
  orderNumber: string
  vendorName: string
  items: OrderItemTemplate[]
  subtotal: number
  deliveryFee: number
  platformFee: number
  tip: number
  discount: number
  total: number
  paymentStatus: string
  deliveryMethod: string
  deliveryLocation: string
  orderUrl: string
}

export function renderOrderConfirmationEmail(input: OrderConfirmationTemplateInput) {
  const name = firstName(input.customerName)
  const itemText = input.items.length
    ? input.items.map((item) => `${item.quantity} × ${item.name} — ${formatPrice(item.subtotal)}`).join('\n')
    : 'Order items are available on your order page.'
  const discountText = input.discount > 0 ? `\nDiscount: -${formatPrice(input.discount)}` : ''
  const subject = `Order confirmed — ${input.orderNumber}`
  const text = [
    `Hey ${name},`, '', `Your order from ${input.vendorName} is confirmed.`, '', itemText, '',
    `Subtotal: ${formatPrice(input.subtotal)}`,
    `Delivery fee: ${formatPrice(input.deliveryFee)}`,
    `Platform fee: ${formatPrice(input.platformFee)}${discountText}`,
    ...(input.tip > 0 ? [`Tip: ${formatPrice(input.tip)}`] : []),
    `Total: ${formatPrice(input.total)}`, '',
    `Payment: ${input.paymentStatus}`, `Method: ${input.deliveryMethod}`,
    `Location: ${input.deliveryLocation}`, '', `Track your order here: ${input.orderUrl}`, '',
    'We’ll keep you updated.', '', 'Cheers,', 'Chibuike', 'LumeX Fud',
  ].join('\n')
  const rows = input.items.length
    ? input.items.map((item) => `<tr><td style="padding:9px 0;border-bottom:1px solid #F3E4D2">${item.quantity} × ${escapeHtml(item.name)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #F3E4D2">${formatPrice(item.subtotal)}</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:9px 0">Order items are available on your order page.</td></tr>'
  const html = layout(`Your ${input.vendorName} order is confirmed.`, `
    <p style="margin:0 0 8px">Hey ${escapeHtml(name)},</p>
    <h1 style="margin:0 0 8px;font-size:25px;line-height:1.25">Your order is confirmed.</h1>
    <p style="margin:0 0 20px;color:#806B58">${escapeHtml(input.vendorName)} · ${escapeHtml(input.orderNumber)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px">${rows}</table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;font-size:14px">
      <tr><td style="padding:4px 0">Subtotal</td><td align="right">${formatPrice(input.subtotal)}</td></tr>
      <tr><td style="padding:4px 0">Delivery fee</td><td align="right">${formatPrice(input.deliveryFee)}</td></tr>
      <tr><td style="padding:4px 0">Platform fee</td><td align="right">${formatPrice(input.platformFee)}</td></tr>
      ${input.tip > 0 ? `<tr><td style="padding:4px 0">Rider tip</td><td align="right">${formatPrice(input.tip)}</td></tr>` : ''}
      ${input.discount > 0 ? `<tr style="color:#2D7D46"><td style="padding:4px 0">Discount</td><td align="right">−${formatPrice(input.discount)}</td></tr>` : ''}
      <tr><td style="padding:10px 0 4px;font-weight:800;font-size:17px">Total</td><td align="right" style="font-weight:800;font-size:17px">${formatPrice(input.total)}</td></tr>
    </table>
    <div style="margin-top:20px;padding:15px;background:#FFF8EF;border-radius:12px;font-size:14px"><strong>${escapeHtml(input.paymentStatus)}</strong><br>${escapeHtml(input.deliveryMethod)} · ${escapeHtml(input.deliveryLocation)}</div>
    ${button('Track your order', input.orderUrl)}
    <p style="margin:22px 0 0">We’ll keep you updated.</p>
    <p style="margin:18px 0 0">Cheers,<br><strong>Chibuike</strong><br>LumeX Fud</p>`)
  return { subject, text, html }
}

export const CUSTOMER_ORDER_STATUS = {
  VENDOR_ACCEPTED: { title: 'Your order has been accepted', message: 'The vendor has accepted your order and is getting things in motion.' },
  PREPARING: { title: 'Your food is being prepared', message: 'The kitchen has started preparing your order.' },
  READY: { title: 'Your order is ready', message: 'Your order is ready. For delivery, it is now waiting for a rider; for pickup, you can follow the collection details in the app.' },
  RIDER_ASSIGNED: { title: 'A rider has been assigned', message: 'A rider is assigned to your order and will collect it when it is ready.' },
  PICKED_UP: { title: 'Your order is on the way', message: 'Your rider has collected the order and is heading to your delivery location.' },
  DELIVERED: { title: 'Your order has arrived', message: 'The rider has marked your order as delivered. Please check it and confirm in the app.' },
  COMPLETED: { title: 'Order delivered', message: 'Your order is complete. We hope it made your day a little easier.' },
  CANCELLED: { title: 'Your order was cancelled', message: 'This order has been cancelled. If payment was captured, any applicable refund will be handled through the original payment method.' },
  REFUNDED: { title: 'Your order was refunded', message: 'The refund for this order has been initiated to the applicable payment method.' },
} as const

export type CustomerEmailStatus = keyof typeof CUSTOMER_ORDER_STATUS

export function isCustomerEmailStatus(status: string): status is CustomerEmailStatus {
  return status === 'PICKED_UP' || status === 'DELIVERED' || status === 'COMPLETED'
}

export function renderOrderStatusEmail(input: {
  customerName?: string | null
  orderNumber: string
  vendorName?: string | null
  status: CustomerEmailStatus
  orderUrl: string
}) {
  if (input.status === 'PICKED_UP') return renderOutForDeliveryEmail(input)
  return renderDeliveredEmail(input)
}

export function renderOutForDeliveryEmail(input: {
  customerName?: string | null
  orderNumber: string
  vendorName?: string | null
  orderUrl: string
}) {
  const name = firstName(input.customerName)
  const vendor = input.vendorName?.trim() ? ` from ${input.vendorName.trim()}` : ''
  const subject = `Your order is on the way - ${input.orderNumber}`
  const text = [`Hey ${name},`, '', `Your rider has collected order ${input.orderNumber}${vendor}. It is now out for delivery.`, '', `Track it here: ${input.orderUrl}`, '', 'See you soon,', 'LumeX Fud'].join('\n')
  const html = layout('Your food is out for delivery.', `
    <p style="margin:0 0 8px">Hey ${escapeHtml(name)},</p>
    <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25">Your order is on the way.</h1>
    <p style="margin:0 0 14px">Your rider has collected the food and is heading to your delivery location.</p>
    <p style="margin:0;color:#806B58">${escapeHtml(input.orderNumber)}${escapeHtml(vendor)}</p>
    ${button('Track your order', input.orderUrl)}
    <p style="margin:20px 0 0">See you soon,<br><strong>LumeX Fud</strong></p>`)
  return { subject, text, html }
}

export function renderDeliveredEmail(input: {
  customerName?: string | null
  orderNumber: string
  vendorName?: string | null
  orderUrl: string
}) {
  const name = firstName(input.customerName)
  const subject = 'Delivered - how was your order?'
  const text = [`Hey ${name},`, '', `Order ${input.orderNumber} has been delivered.`, '', 'I hope it arrived just right. A quick rating helps us keep vendors and riders accountable, and makes the next order better.', '', `Rate your order: ${input.orderUrl}`, '', 'Cheers,', 'Chibuike', 'LumeX Fud'].join('\n')
  const html = layout('Your order has been delivered.', `
    <p style="margin:0 0 8px">Hey ${escapeHtml(name)},</p>
    <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25">Delivered. How did we do?</h1>
    <p style="margin:0 0 14px">I hope your order arrived just right. A quick rating helps us keep vendors and riders accountable, and makes the next order better.</p>
    <p style="margin:0;color:#806B58">${escapeHtml(input.orderNumber)}</p>
    ${button('Rate your order', input.orderUrl)}
    <p style="margin:20px 0 0">Cheers,<br><strong>Chibuike</strong><br>LumeX Fud</p>`)
  return { subject, text, html }
}

export function renderDelayedOrderEmail(input: {
  customerName?: string | null
  orderNumber: string
  vendorName?: string | null
  projectedDeliveryAt?: string | null
  orderUrl: string
}) {
  const name = firstName(input.customerName)
  const projected = input.projectedDeliveryAt ? new Date(input.projectedDeliveryAt) : null
  const eta = projected && !Number.isNaN(projected.getTime())
    ? projected.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
    : null
  const etaLine = eta ? `Our latest estimate is ${eta}.` : 'We are working to get it moving again as quickly as possible.'
  const subject = `A quick update on order ${input.orderNumber}`
  const text = [`Hey ${name},`, '', `Your order is taking longer than it should. ${etaLine}`, '', 'We are watching it closely and pushing the team to get it to you safely, without wasting another minute.', '', `Track your order: ${input.orderUrl}`, '', 'Sorry about the wait,', 'Chibuike', 'LumeX Fud'].join('\n')
  const html = layout('Your order is taking longer than planned.', `
    <p style="margin:0 0 8px">Hey ${escapeHtml(name)},</p>
    <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25">A quick, honest update.</h1>
    <p style="margin:0 0 14px">Your order is taking longer than it should. ${escapeHtml(etaLine)}</p>
    <p style="margin:0">We are watching it closely and pushing the team to get it to you safely, without wasting another minute.</p>
    ${button('Track your order', input.orderUrl)}
    <p style="margin:20px 0 0">Sorry about the wait,<br><strong>Chibuike</strong><br>LumeX Fud</p>`)
  return { subject, text, html }
}

export function renderLegacyOrderStatusEmail(input: {
  customerName?: string | null
  orderNumber: string
  vendorName?: string | null
  status: CustomerEmailStatus
  orderUrl: string
}) {
  const copy = CUSTOMER_ORDER_STATUS[input.status]
  const name = firstName(input.customerName)
  const vendor = input.vendorName?.trim() ? ` from ${input.vendorName.trim()}` : ''
  const subject = `${copy.title} — ${input.orderNumber}`
  const text = [`Hi ${name},`, '', `${copy.message}`, '', `Order ${input.orderNumber}${vendor}`, `View order: ${input.orderUrl}`].join('\n')
  const html = layout(copy.title, `
    <p style="margin:0 0 8px">Hi ${escapeHtml(name)},</p>
    <h1 style="margin:0 0 12px;font-size:25px;line-height:1.25">${escapeHtml(copy.title)}</h1>
    <p style="margin:0 0 14px">${escapeHtml(copy.message)}</p>
    <p style="margin:0;color:#806B58">${escapeHtml(input.orderNumber)}${escapeHtml(vendor)}</p>
    ${button('View order', input.orderUrl)}`)
  return { subject, text, html }
}
