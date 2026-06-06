import { createSupabaseAdmin } from '../supabase/server'
import { sendWhatsAppWithFallback } from '../termii/whatsapp'
import { renderTemplate } from '../termii/templates'
import { recordPlatformEarning } from '../platform-earnings'
import { processCustomerTopup } from '../customer-wallet'

export type PaystackEvent =
  | 'charge.success'
  | 'charge.failed'
  | 'transfer.success'
  | 'transfer.failed'
  | 'transfer.reversed'
  | 'refund.processed'
  | 'refund.failed'
  | string

export interface PaystackWebhookPayload {
  event: PaystackEvent
  data: Record<string, unknown>
}

export async function processWebhookAsync(payload: PaystackWebhookPayload): Promise<void> {
  const { event, data } = payload
  const db = createSupabaseAdmin()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  switch (event) {
    case 'charge.success': {
      const reference = data.reference as string
      const metadata = (data.metadata as Record<string, unknown>) ?? {}

      if ((metadata.type as string) === 'SUBSCRIPTION') {
        await handleSubscriptionPayment(db, reference, metadata)
        break
      }

      // Customer wallet top-up. Without this branch the payment fell through to
      // the order path below, matched no order, and silently no-op'd — the
      // customer was charged but never credited. processCustomerTopup is
      // idempotent (topup_customer_wallet RPC keys on the unique reference), so
      // a Paystack retry can't double-credit.
      if ((metadata.type as string) === 'WALLET_TOPUP') {
        await handleWalletTopup(reference, data, metadata)
        break
      }

      // Regular order payment
      const { data: order, error } = await db
        .from('orders')
        .update({ payment_status: 'PAID', status: 'PENDING', updated_at: new Date().toISOString() })
        .eq('paystack_reference', reference)
        .eq('payment_status', 'PENDING')
        .select('id, order_number, vendor_id, customer_id, total_amount, subtotal')
        .single()

      if (error || !order) break

      // Notify vendor
      const { data: vendor } = await db
        .from('vendors')
        .select('phone, shop_name')
        .eq('id', order.vendor_id)
        .single()

      const { data: items } = await db
        .from('order_items')
        .select('name, quantity')
        .eq('order_id', order.id)

      if (vendor) {
        const itemsSummary = (items ?? []).map((i: { name: string; quantity: number }) => `${i.name} x${i.quantity}`).join(', ')
        void sendWhatsAppWithFallback({
          to: vendor.phone as string,
          message: renderTemplate('ORDER_PENDING', {
            order_number: order.order_number as string,
            total: Math.round((order.total_amount as number) / 100),
            customer_first_name: 'Customer',
            items_summary: itemsSummary,
            dashboard_url: `${appUrl}/vendor-dashboard`,
          }),
        }).catch(() => {})
      }
      break
    }

    case 'charge.failed': {
      const reference = data.reference as string
      // Guard the transition: only cancel an order that is still awaiting its
      // first payment. Without the payment_status + status filter, a late or
      // replayed charge.failed could clobber an order that had already been paid
      // and progressed (e.g. VENDOR_ACCEPTED), wrongly cancelling it. A failed
      // top-up/subscription charge has no matching order row, so it no-ops here.
      const { data: order } = await db
        .from('orders')
        .update({ payment_status: 'FAILED', status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('paystack_reference', reference)
        .eq('payment_status', 'PENDING')
        .in('status', ['PENDING_PAYMENT', 'PENDING'])
        .select('order_number, customer_id, guest_phone')
        .maybeSingle()

      if (!order) break

      // Get customer phone
      let customerPhone: string | null = (order.guest_phone as string) ?? null
      if (!customerPhone && order.customer_id) {
        const { data: customer } = await db
          .from('customers')
          .select('phone')
          .eq('id', order.customer_id)
          .single()
        customerPhone = (customer?.phone as string) ?? null
      }

      if (customerPhone) {
        void sendWhatsAppWithFallback({
          to: customerPhone,
          message: renderTemplate('CANCELLED', {
            order_number: order.order_number as string,
            cancellation_reason: "Payment didn't go through. Your cart is saved — try again?",
          }),
        }).catch(() => {})
      }
      break
    }

    case 'transfer.success': {
      const transferCode = (data.transfer_code as string) ?? ''
      await db
        .from('wallet_transactions')
        .update({ status: 'COMPLETED' })
        .eq('paystack_transfer_code', transferCode)
      break
    }

    case 'transfer.failed':
    case 'transfer.reversed': {
      const transferCode = (data.transfer_code as string) ?? ''
      const failureReason = (data.reason as string) ?? 'Transfer failed'

      const { data: txn } = await db
        .from('wallet_transactions')
        .update({ status: 'FAILED', failure_reason: failureReason })
        .eq('paystack_transfer_code', transferCode)
        .select('user_id, user_type, amount')
        .single()

      if (txn) {
        // Refund balance to wallet
        await db.rpc('credit_wallet', {
          p_user_id: txn.user_id,
          p_user_type: txn.user_type,
          p_amount: txn.amount,
          p_reference: `refund-${transferCode}`,
        })
      }
      break
    }

    case 'refund.processed': {
      const refundRef = (data.refund_reference as string) ?? (data.id as string) ?? ''
      const orderRef = (data.transaction_reference as string) ?? ''
      await db
        .from('refunds')
        .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
        .eq('paystack_transaction_reference', orderRef)

      // Notify customer
      const { data: refund } = await db
        .from('refunds')
        .select('order_id, amount')
        .eq('paystack_transaction_reference', orderRef)
        .single()

      if (refund) {
        const { data: order } = await db
          .from('orders')
          .select('order_number, customer_id, guest_phone')
          .eq('id', refund.order_id)
          .single()

        if (order) {
          let phone: string | null = (order.guest_phone as string) ?? null
          if (!phone && order.customer_id) {
            const { data: c } = await db.from('customers').select('phone').eq('id', order.customer_id).single()
            phone = (c?.phone as string) ?? null
          }
          if (phone) {
            void sendWhatsAppWithFallback({
              to: phone,
              message: renderTemplate('REFUND_PROCESSED', {
                amount: Math.round((refund.amount as number) / 100),
                order_number: order.order_number as string,
              }),
            }).catch(() => {})
          }
        }
      }
      void refundRef // used for idempotency upstream
      break
    }

    case 'refund.failed': {
      const orderRef = (data.transaction_reference as string) ?? ''
      await db
        .from('refunds')
        .update({ status: 'FAILED', failure_reason: (data.reason as string) ?? 'Unknown' })
        .eq('paystack_transaction_reference', orderRef)

      // Alert admin
      const adminPhone = process.env.ADMIN_PHONE
      if (adminPhone) {
        void sendWhatsAppWithFallback({
          to: adminPhone,
          message: `❌ Refund failed for transaction ${orderRef}\nReason: ${(data.reason as string) ?? 'Unknown'}\nManual intervention needed.`,
        }).catch(() => {})
      }
      break
    }
  }
}

async function handleSubscriptionPayment(
  db: ReturnType<typeof createSupabaseAdmin>,
  reference: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const vendorId = metadata.vendor_id as string
  if (!vendorId) return

  const { data: vendor } = await db
    .from('vendors')
    .select('subscription_tier')
    .eq('id', vendorId)
    .single()

  if (!vendor) return

  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  const subscriptionAmount = Number(metadata.amount ?? 0)

  await db.from('vendor_subscriptions').insert({
    vendor_id: vendorId,
    amount: subscriptionAmount,
    paystack_reference: reference,
    paid_at: now.toISOString(),
    period_start: now.toISOString(),
    period_end: periodEnd.toISOString(),
    status: 'ACTIVE',
  })

  await db
    .from('vendors')
    .update({ subscription_paid_until: periodEnd.toISOString() })
    .eq('id', vendorId)

  // Record as platform revenue (fire-and-forget)
  void recordPlatformEarning({
    type:        'VENDOR_SUBSCRIPTION',
    amount_kobo: subscriptionAmount,
    description: `Vendor subscription — vendor ${vendorId} — ref ${reference}`,
  })
}

async function handleWalletTopup(
  reference: string,
  data: Record<string, unknown>,
  metadata: Record<string, unknown>
): Promise<void> {
  const customerId = metadata.customer_id as string | undefined
  const amountKobo = Number(data.amount ?? 0)
  if (!customerId || !Number.isFinite(amountKobo) || amountKobo <= 0) return

  // processCustomerTopup recomputes the bonus from settings (never trusts the
  // client-supplied metadata bonus) and credits both TOPUP + TOPUP_BONUS rows
  // atomically. Idempotent on `reference`.
  await processCustomerTopup({
    customerId,
    amountKobo,
    reference,
    customerPhone: metadata.customer_phone as string | undefined,
    customerName:  metadata.customer_name as string | undefined,
  })
}
