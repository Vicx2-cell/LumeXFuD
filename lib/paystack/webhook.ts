import { createSupabaseAdmin } from '../supabase/server'
import { sendWhatsAppWithFallback } from '../notify'
import { renderTemplate } from '../notify-templates'
import { recordPlatformEarning } from '../platform-earnings'
import { processCustomerTopup, spendCustomerWallet, isCustomerWalletEnabled } from '../customer-wallet'
import { refundTransaction } from './transfer'
import { verifyPaystackTransaction } from './init'

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'

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

      // Regular order payment.
      // Find the pending order for this reference BEFORE crediting.
      const { data: pending } = await db
        .from('orders')
        .select('id, order_number, vendor_id, customer_id, total_amount, subtotal, wallet_amount_kobo, payment_method, scheduled_for, scheduled_release_at')
        .eq('paystack_reference', reference)
        .eq('payment_status', 'PENDING')
        .maybeSingle()

      if (!pending) break

      // A4 — independent re-verification before marking the order paid. The
      // HMAC-signed payload is only a signal; confirm status + amount straight
      // from Paystack. On a DEFINITIVE negative (Paystack does not say success)
      // we never mark the order paid. On a TRANSIENT verify error we fall back
      // to the authenticated payload amount — HMAC already proves authenticity,
      // so a Paystack API hiccup must not strand a genuinely-paid order — but we
      // log it. The exact `paidAmount === expectedCharge` check below is the
      // real money guard either way.
      let paidAmount = Number(data.amount)
      try {
        const verified = await verifyPaystackTransaction(reference)
        if (verified.status !== 'success') {
          console.warn(`[webhook] order charge ${reference} not 'success' on verify (status=${verified.status}) — not marking paid`)
          break
        }
        paidAmount = Number(verified.amount)
      } catch (err) {
        console.error(`[webhook] order verify failed for ${reference}, falling back to signed payload amount:`, err)
      }

      // The card only ever pays the NON-wallet portion. For a plain PAYSTACK
      // order wallet_amount_kobo is 0 so this equals total_amount; for a SPLIT
      // it's the remainder after the wallet. A mismatch means reference reuse, a
      // partial charge, or config drift — never credit; alert for manual review.
      const walletPortion = Number(pending.wallet_amount_kobo) || 0
      const expectedCharge = Number(pending.total_amount) - walletPortion
      if (!Number.isFinite(paidAmount) || paidAmount !== expectedCharge) {
        console.error(
          `[webhook] amount mismatch on ${reference}: charged ${paidAmount}, expected ${expectedCharge}`
        )
        const adminPhone = process.env.ADMIN_PHONE
        if (adminPhone) {
          void sendWhatsAppWithFallback({
            to: adminPhone,
            message:
              `⚠️ Payment amount mismatch on order ${pending.order_number}\n` +
              `Charged: ₦${Math.round((Number.isFinite(paidAmount) ? paidAmount : 0) / 100)}\n` +
              `Expected: ₦${Math.round(expectedCharge / 100)}\n` +
              `Order NOT marked paid. Manual review needed.`,
          }).catch(() => {})
        }
        break
      }

      // SPLIT: the card remainder is confirmed — debit the wallet portion now.
      // This is the single commit point for split orders, so an abandoned
      // checkout never touched the wallet. If the wallet can no longer cover its
      // part (spent elsewhere since checkout) we must not half-pay the order:
      // refund the card remainder, cancel, and alert — never mark it paid.
      if (pending.payment_method === 'SPLIT' && walletPortion > 0 && pending.customer_id) {
        let spendOk = false
        try {
          const spend = await spendCustomerWallet({
            customerId:  pending.customer_id,
            amountKobo:  walletPortion,
            orderId:     pending.id,
            orderNumber: pending.order_number,
            reference:   `CWUSE-${pending.id}`,
          })
          spendOk = spend.success
        } catch (err) {
          console.error(`[webhook] split wallet debit RPC error on ${reference}:`, err)
        }

        if (!spendOk) {
          let refundOk = true
          try {
            await refundTransaction(reference, paidAmount)
          } catch (refundErr) {
            refundOk = false
            console.error(`[webhook] split refund failed on ${reference}:`, refundErr)
          }
          await db
            .from('orders')
            .update({ status: 'CANCELLED', payment_status: 'FAILED', updated_at: new Date().toISOString() })
            .eq('id', pending.id)
            .eq('payment_status', 'PENDING')
          await db.from('refunds').insert({
            order_id:                       pending.id,
            paystack_transaction_reference: reference,
            amount_kobo:                    paidAmount,
            reason:                         'Split payment: wallet portion could not be debited',
            status:                         refundOk ? 'PROCESSING' : 'NEEDS_ATTENTION',
            triggered_by:                   'SYSTEM_WEBHOOK',
          })
          const adminPhone = process.env.ADMIN_PHONE
          if (adminPhone) {
            void sendWhatsAppWithFallback({
              to: adminPhone,
              message:
                `⚠️ Split order ${pending.order_number}: wallet debit failed after card charged.\n` +
                `Card portion ₦${Math.round(paidAmount / 100)} ${refundOk ? 'refund initiated' : 'REFUND FAILED — refund manually'}.`,
            }).catch(() => {})
          }
          break
        }
      }

      // SCHEDULED (pre-order): park as PAID + SCHEDULED — the release cron hands
      // it to the vendor at scheduled_release_at, so DON'T notify now. If the
      // release time has already passed (slow payment), fall through to a normal
      // immediate PENDING release. pending_since drives the auto-cancel clock.
      const nowIso = new Date().toISOString()
      const releaseInFuture =
        !!pending.scheduled_for &&
        !!pending.scheduled_release_at &&
        new Date(pending.scheduled_release_at as string).getTime() > Date.now()

      const { data: order, error } = await db
        .from('orders')
        .update(
          releaseInFuture
            ? { payment_status: 'PAID', status: 'SCHEDULED', updated_at: nowIso }
            : { payment_status: 'PAID', status: 'PENDING', pending_since: nowIso, updated_at: nowIso },
        )
        .eq('paystack_reference', reference)
        .eq('payment_status', 'PENDING')
        .select('id, order_number, vendor_id, customer_id, total_amount, subtotal')
        .single()

      if (error || !order) break

      // Scheduled orders are handed to the vendor later by the release cron.
      if (releaseInFuture) break

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

      // Group order? Tell every participant the food is on the way + where to.
      // Best-effort + separate query so a missing group_order_id column (migration
      // 065 not yet run) can NEVER break marking the order paid above.
      try {
        const { data: gRow } = await db.from('orders').select('group_order_id, delivery_address').eq('id', order.id).maybeSingle()
        const g = gRow as { group_order_id: string | null; delivery_address: string | null } | null
        if (g?.group_order_id) {
          const { notifyGroupOrderPlaced } = await import('../group-order')
          await notifyGroupOrderPlaced(db, {
            groupOrderId: g.group_order_id,
            orderNumber: order.order_number as string,
            deliveryAddress: g.delivery_address ?? 'your location',
            appUrl,
          })
        }
      } catch (err) {
        console.error('[webhook] group-order notify skipped:', err)
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
        // Restore the debited balance. credit_wallet is atomic (FOR UPDATE) and
        // idempotent on the reference, so a duplicate transfer.failed /
        // transfer.reversed pair can't double-credit. If it fails (e.g. wallet
        // row missing), the money is stuck debited — alert an admin loudly
        // rather than swallowing it.
        const { data: restored, error: creditErr } = await db.rpc('credit_wallet', {
          p_user_id: txn.user_id,
          p_user_type: txn.user_type,
          p_amount: txn.amount,
          p_reference: `refund-${transferCode}`,
        })

        if (creditErr || restored !== true) {
          console.error(
            `[webhook] credit_wallet reversal FAILED for ${txn.user_type} ${txn.user_id} ` +
            `(${txn.amount} kobo, transfer ${transferCode}):`, creditErr?.message ?? 'returned false'
          )
          const adminPhone = process.env.ADMIN_PHONE
          if (adminPhone) {
            void sendWhatsAppWithFallback({
              to: adminPhone,
              message:
                `🚨 Payout reversal NOT credited back.\n` +
                `${txn.user_type} ${txn.user_id}\n` +
                `Amount: ₦${Math.round(Number(txn.amount) / 100)}\n` +
                `Transfer: ${transferCode}\n` +
                `Wallet balance must be restored manually.`,
            }).catch(() => {})
          }
        }
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
  if (!customerId) return

  // Customer-wallet kill switch. The webhook itself ALWAYS runs (reconciliation,
  // order payments, vendor/rider crediting, subscriptions all stay live) — we
  // only refuse to CREDIT a customer balance while the wallet is disabled. A
  // top-up cannot normally be initiated while off (init routes are gated), so
  // this only catches a payment that crossed the toggle: don't credit, and alert
  // an admin to refund the payer manually.
  if (!(await isCustomerWalletEnabled())) {
    console.warn(`[webhook] customer wallet disabled — NOT crediting top-up ${reference}`)
    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone) {
      void sendWhatsAppWithFallback({
        to: adminPhone,
        message:
          `⚠️ Wallet top-up ${reference} arrived while the customer wallet is DISABLED.\n` +
          `NOT credited. Refund the payer manually if the charge went through.`,
      }).catch(() => {})
    }
    return
  }

  // A4 — independent re-verification. The webhook payload is HMAC-authenticated
  // but is still only a *signal*: re-fetch the transaction from Paystack and
  // credit ONLY the amount Paystack itself confirms it received. Never trust the
  // payload's `data.amount` for money-in. processCustomerTopup is idempotent on
  // `reference`, so if this drops (no webhook retry) the top-up can be safely
  // re-driven later without double-crediting.
  let verified: Awaited<ReturnType<typeof verifyPaystackTransaction>>
  try {
    verified = await verifyPaystackTransaction(reference)
  } catch (err) {
    console.error(`[webhook] top-up verify failed for ${reference}:`, err)
    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone) {
      void sendWhatsAppWithFallback({
        to: adminPhone,
        message:
          `⚠️ Wallet top-up ${reference}: could not verify with Paystack.\n` +
          `NOT credited — verify the transaction and credit manually.`,
      }).catch(() => {})
    }
    return
  }

  // Definitive negative — Paystack does not say this charge succeeded. Do not credit.
  if (verified.status !== 'success') {
    console.warn(`[webhook] top-up ${reference} not 'success' on verify (status=${verified.status}) — skipping credit`)
    return
  }

  const amountKobo = Number(verified.amount ?? 0)
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) return

  // processCustomerTopup recomputes the bonus from settings (never trusts the
  // client-supplied metadata bonus) and credits both TOPUP + TOPUP_BONUS rows
  // atomically. Idempotent on `reference`.
  await processCustomerTopup({
    customerId,
    amountKobo,
    reference,
    customerPhone: metadata.customer_phone as string | undefined,
    customerName:  metadata.customer_name as string | undefined,
    // When a parent/sponsor funded it, name them so the student sees who sent it
    // (falls back to "A family member" if the sender left their name blank).
    sponsorName:   metadata.is_sponsor ? ((metadata.sponsor_name as string | undefined)?.trim() || 'A family member') : undefined,
  })
}
