import type { createSupabaseAdmin } from './supabase/server'
import { sendTransactionalEmail } from './email'

type DB = ReturnType<typeof createSupabaseAdmin>

export async function sendOrderCompletionEmail(
  db: DB,
  order: {
    order_number: string
    customer_id: string | null
    vendor_id: string | null
  },
): Promise<void> {
  if (!order.customer_id) return

  const [{ data: customer }, { data: vendor }] = await Promise.all([
    db.from('customers').select('email, name').eq('id', order.customer_id).maybeSingle(),
    order.vendor_id
      ? db.from('vendors').select('shop_name').eq('id', order.vendor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const email = String((customer as { email?: string | null } | null)?.email ?? '').trim()
  if (!email) return

  const customerName = String((customer as { name?: string | null } | null)?.name ?? '').trim() || 'there'
  const shopName = String((vendor as { shop_name?: string | null } | null)?.shop_name ?? '').trim()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const orderUrl = `${appUrl}/order/${order.order_number}`
  const subject = `Your order ${order.order_number} is complete`
  const text = [
    `Hi ${customerName},`,
    '',
    `Your order ${order.order_number}${shopName ? ` from ${shopName}` : ''} is complete.`,
    `View the receipt and order details here: ${orderUrl}`,
    '',
    'Thanks for ordering with LumeX Fud.',
  ].join('\n')

  await sendTransactionalEmail({
    to: email,
    subject,
    text,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <p>Hi ${customerName},</p>
        <p>Your order <strong>${order.order_number}</strong>${shopName ? ` from <strong>${shopName}</strong>` : ''} is complete.</p>
        <p><a href="${orderUrl}" style="color:#d97706;text-decoration:none">View your receipt and order details</a></p>
        <p>Thanks for ordering with LumeX Fud.</p>
      </div>
    `,
  })
}
