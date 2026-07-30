import { createSupabaseAdmin } from '../supabase/server'
import { sendWhatsAppWithFallback } from '../notify'
import { renderTemplate } from '../notify-templates'
import { notifyInApp } from '../notifications'
import { sendPushToUser } from '../push'
import { recordPlatformEarning } from '../platform-earnings'
import { processCustomerTopup, spendCustomerWallet, isCustomerWalletEnabled } from '../customer-wallet'
import { consumeWalletReservation, findWalletReservationByOrder } from '../wallet-reservations'
import { findOrderPaymentIntentByReference, finalizeOrderPaymentIntent, markOrderPaymentIntentVerified, quarantineOrderPaymentIntent } from '../order-payment-intents'
import { refundTransaction } from './transfer'
import { verifyPaystackTransaction } from './init'
import { processPremiumOrBoostWebhook } from './billing'
import { recordSecurityEvent } from '../security-events'
import { sendOrderConfirmationEmail } from '../transactional-email'

// Naira for a refund notification, derived from the canonical kobo column.
// Guards against NaN: a missing/garbled amount renders ₦0, never "NaN".
export function refundNaira(amountKobo: unknown): number {
  const n = Number(amountKobo)
  return Number.isFinite(n) ? Math.round(n / 100) : 0
}

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

export function dedicatedAccountNumber(data: Record<string, unknown>): string | null {
  const authorization = data.authorization as Record<string, unknown> | undefined
  const dedicated = data.dedicated_account as Record<string, unknown> | undefined
  const value = authorization?.receiver_bank_account_number ?? dedicated?.account_number ?? data.account_number
  return typeof value === 'string' && /^\d{10}$/.test(value) ? value : null
}

export interface RefundWebhookCandidate {
  id: string
  paystack_refund_reference: string | null
  amount_kobo: number | null
  created_at?: string | null
}

export function refundWebhookAmountKobo(data: Record<string, unknown>): number | null {
  const raw = data.amount ?? data.refund_amount ?? data.refunded_amount
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface DirectOrderPaymentContext {
  id: string
  order_number: string
  vendor_id: string | null
  customer_id: string | null
  guest_phone: string | null
  guest_name: string | null
  payment_status: string | null
  status: string | null
  total_amount: number | null
  subtotal: number | null
  wallet_amount_kobo: number | null
  payment_method: string | null
  scheduled_for: string | null
  scheduled_release_at: string | null
}

export interface DirectOrderPaymentResult {
  accepted: boolean
  duplicate: boolean
  reason?: string
  intentId?: string
  verifiedAmount?: number
  verifiedCurrency?: string
  verifiedEnvironment?: 'test' | 'production'
  verifiedTransactionId?: string | null
}

export async function verifyAndRecordDirectOrderPayment(params: {
  db: ReturnType<typeof createSupabaseAdmin>
  reference: string
  data: Record<string, unknown>
  pending: DirectOrderPaymentContext
}): Promise<DirectOrderPaymentResult> {
  const intent = await findOrderPaymentIntentByReference(params.db, params.reference)
  if (!intent) {
    return { accepted: false, duplicate: false, reason: 'unknown_reference' }
  }

  if (intent.status === 'FINALIZED') {
    return { accepted: false, duplicate: true, reason: 'already_finalized', intentId: intent.id }
  }

  const environment = paystackEnvironmentFromSecret(process.env.PAYSTACK_SECRET_KEY)
  let verified
  try {
    verified = await verifyPaystackTransaction(params.reference)
  } catch (err) {
    console.error(`[webhook] direct payment verify failed for ${params.reference}:`, err)
    return { accepted: false, duplicate: false, reason: 'verification_failed', intentId: intent.id }
  }

  const verifiedAmount = Number(verified.amount)
  const verifiedCurrency = String(verified.currency ?? params.data.currency ?? 'NGN').toUpperCase()
  const verifiedReference = String(verified.reference ?? params.reference)
  const providerTransactionId = params.data.id != null ? String(params.data.id) : null

  if (verified.status !== 'success') {
    return { accepted: false, duplicate: false, reason: 'provider_not_success', intentId: intent.id }
  }
  if (verifiedReference !== params.reference) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'reference_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: { ...params.data, verified_reference: verifiedReference },
    })
    return { accepted: false, duplicate: false, reason: 'reference_mismatch', intentId: intent.id }
  }
  if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'invalid_amount',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'invalid_amount', intentId: intent.id }
  }
  if (verifiedAmount !== intent.amount_kobo) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'amount_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'amount_mismatch', intentId: intent.id }
  }
  if (verifiedCurrency !== intent.currency) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'currency_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'currency_mismatch', intentId: intent.id }
  }
  if (environment !== intent.environment) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'environment_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'environment_mismatch', intentId: intent.id }
  }
  if (intent.order_id !== params.pending.id) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'order_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'order_mismatch', intentId: intent.id }
  }
  if (intent.customer_id && intent.customer_id !== params.pending.customer_id) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'customer_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'customer_mismatch', intentId: intent.id }
  }
  if (!intent.customer_id && intent.guest_phone && intent.guest_phone !== params.pending.guest_phone) {
    await quarantineOrderPaymentIntent(params.db, {
      orderId: params.pending.id,
      reason: 'guest_mismatch',
      providerAmountKobo: verifiedAmount,
      providerCurrency: verifiedCurrency,
      providerEnvironment: environment,
      providerPayload: params.data,
    })
    return { accepted: false, duplicate: false, reason: 'guest_mismatch', intentId: intent.id }
  }

  await markOrderPaymentIntentVerified(params.db, {
    orderId: params.pending.id,
    amountKobo: verifiedAmount,
    currency: verifiedCurrency,
    environment,
    providerPayload: {
      ...params.data,
      verified_reference: verifiedReference,
      verified_transaction_id: providerTransactionId,
      verified_status: verified.status,
    },
  })

  const [receivableId, clearingId] = await Promise.all([
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'PAYSTACK_RECEIVABLE',
      p_owner_type: 'PAYSTACK',
      p_owner_id: null,
      p_currency: verifiedCurrency,
      p_environment: environment,
      p_metadata: {
        source: 'direct_checkout',
        order_id: params.pending.id,
        order_number: params.pending.order_number,
      },
    }),
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'COLLECTION_CLEARING',
      p_owner_type: 'PLATFORM',
      p_owner_id: null,
      p_currency: verifiedCurrency,
      p_environment: environment,
      p_metadata: {
        source: 'direct_checkout',
        order_id: params.pending.id,
        order_number: params.pending.order_number,
      },
    }),
  ])

  if (receivableId.error) {
    throw new Error(`Could not ensure Paystack receivable account: ${receivableId.error.message}`)
  }
  if (clearingId.error) {
    throw new Error(`Could not ensure collection clearing account: ${clearingId.error.message}`)
  }

  const posted = await params.db.rpc('post_ledger_journal', {
    p_journal_type: 'DIRECT_PAYSTACK_CHARGE',
    p_business_reference: params.pending.order_number,
    p_idempotency_key: `paystack:direct-payment:${environment}:${params.reference}`,
    p_currency: verifiedCurrency,
    p_source: 'paystack_webhook',
    p_actor_type: 'system',
    p_actor_id: null,
    p_correlation_id: verifiedReference,
    p_metadata: {
      environment,
      payment_intent_id: intent.id,
      payment_intent_reference: intent.internal_reference,
      order_id: params.pending.id,
      order_number: params.pending.order_number,
      paystack_reference: params.reference,
      paystack_transaction_id: providerTransactionId,
      customer_id: intent.customer_id,
      guest_phone: intent.guest_phone,
      amount_kobo: verifiedAmount,
      currency: verifiedCurrency,
      expected_vendor_allocation_kobo: intent.expected_vendor_allocation_kobo,
      expected_rider_allocation_kobo: intent.expected_rider_allocation_kobo,
      expected_platform_allocation_kobo: intent.expected_platform_allocation_kobo,
      payment_method: params.pending.payment_method,
    },
    p_reversal_of_journal_id: null,
    p_entries: [
      {
        account_id: receivableId.data as string,
        side: 'DEBIT',
        amount_kobo: verifiedAmount,
        metadata: {
          flow: 'direct_checkout',
          reference: params.reference,
          order_id: params.pending.id,
        },
      },
      {
        account_id: clearingId.data as string,
        side: 'CREDIT',
        amount_kobo: verifiedAmount,
        metadata: {
          flow: 'direct_checkout',
          reference: params.reference,
          order_id: params.pending.id,
        },
      },
    ],
  })

  if (posted.error) {
    throw new Error(`Could not post direct payment journal: ${posted.error.message}`)
  }

  return {
    accepted: true,
    duplicate: false,
    intentId: intent.id,
    verifiedAmount,
    verifiedCurrency,
    verifiedEnvironment: environment,
    verifiedTransactionId: providerTransactionId,
  }
}

export function chooseRefundWebhookTarget(
  rows: RefundWebhookCandidate[],
  data: Record<string, unknown>,
): { refundId: string | null; ambiguous: boolean; reason?: string } {
  const refundRef = String(data.refund_reference ?? data.reference ?? data.id ?? '').trim()
  if (refundRef) {
    const exact = rows.filter((row) => row.paystack_refund_reference === refundRef)
    if (exact.length === 1) return { refundId: exact[0].id, ambiguous: false }
    if (exact.length > 1) return { refundId: null, ambiguous: true, reason: 'duplicate_provider_reference' }
  }

  const amountKobo = refundWebhookAmountKobo(data)
  if (amountKobo != null) {
    const byAmount = rows.filter((row) => Number(row.amount_kobo) === amountKobo)
    if (byAmount.length === 1) return { refundId: byAmount[0].id, ambiguous: false }
    if (byAmount.length > 1) return { refundId: null, ambiguous: true, reason: 'amount_matches_multiple_refunds' }
  }

  if (rows.length === 1) return { refundId: rows[0].id, ambiguous: false }
  if (rows.length > 1) return { refundId: null, ambiguous: true, reason: 'multiple_processing_refunds' }
  return { refundId: null, ambiguous: false, reason: 'no_processing_refund' }
}

export async function processWebhookAsync(payload: PaystackWebhookPayload): Promise<void> {
  const { event, data } = payload
  const db = createSupabaseAdmin()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'

  switch (event) {
    case 'charge.success': {
      const reference = data.reference as string
      const metadata = (data.metadata as Record<string, unknown>) ?? {}

      if ((metadata.type as string) === 'PREMIUM_SUBSCRIPTION' || (metadata.type as string) === 'BOOST_PURCHASE') {
        await processPremiumOrBoostWebhook('charge.success', data)
        break
      }

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

      // A DVA is only a payment rail. Persist the independently verified
      // receipt for reconciliation, but never turn it into stored value.
      const receiverAccount = dedicatedAccountNumber(data)
      if (receiverAccount) {
        const { data: virtualAccount } = await db.from('customer_virtual_accounts')
          .select('id, customer_id, account_number, account_name, paystack_customer_code, provider_slug, bank_name, status')
          .eq('account_number', receiverAccount)
          .eq('status', 'ACTIVE')
          .maybeSingle()
        if (virtualAccount) {
          const verified = await verifyPaystackTransaction(reference)
          if (verified.status !== 'success' || Number(verified.amount) <= 0) break
          await db.from('virtual_account_receipts').insert({
            customer_virtual_account_id: virtualAccount.id,
            paystack_reference: reference,
            paystack_transaction_id: data.id != null ? String(data.id) : null,
            amount_kobo: Number(verified.amount),
            currency: String(data.currency ?? 'NGN'),
            status: 'UNALLOCATED',
            provider_payload: data,
          })
          await creditVerifiedDvaDeposit({
            db,
            reference,
            verified,
            data,
            virtualAccount: virtualAccount as {
              id: string
              customer_id: string
              account_number: string | null
              account_name: string | null
              paystack_customer_code: string | null
              provider_slug: string | null
              bank_name: string | null
              status: string
            },
          })
          break
        }
      }

      // Regular order payment.
      // Find the pending order for this reference BEFORE crediting.
      const { data: pending } = await db
        .from('orders')
        .select('id, order_number, vendor_id, customer_id, guest_phone, guest_name, status, payment_status, total_amount, subtotal, wallet_amount_kobo, payment_method, scheduled_for, scheduled_release_at')
        .eq('paystack_reference', reference)
        .eq('payment_status', 'PENDING')
        .maybeSingle()

      if (!pending) break

      const directPayment = await verifyAndRecordDirectOrderPayment({ db, reference, data, pending })
      if (!directPayment.accepted) {
        if (directPayment.reason === 'unknown_reference') {
          console.warn(`[webhook] unknown direct payment reference ${reference}`)
        }
        if (directPayment.duplicate || directPayment.reason === 'already_finalized') {
          break
        }
        break
      }

      const paidAmount = directPayment.verifiedAmount ?? Number(data.amount)

      // The card only ever pays the NON-wallet portion. For a plain PAYSTACK
      // order wallet_amount_kobo is 0 so this equals total_amount; for a SPLIT
      // it's the remainder after the wallet.
      //
      // We require the customer to have paid AT LEAST the expected amount, not
      // EXACTLY it. When the Paystack account has "Customer bears transaction
      // charges" enabled, Paystack grosses the charge up so the platform still
      // NETS the order total — e.g. expected ₦8,050 is charged as ₦8,274.12
      // ((805000+10000)/(1-0.015)). The settled amount is still the order total,
      // so an exact-equality check wrongly rejected every fee-bearing order and
      // left it stuck in PENDING_PAYMENT ("paid but never appears"). We still
      // reject UNDERpayment (reference reuse / partial charge) and alert.
      const walletPortion = Number(pending.wallet_amount_kobo) || 0
      const expectedCharge = Number(pending.total_amount) - walletPortion
      if (!Number.isFinite(paidAmount) || paidAmount < expectedCharge) {
        console.error(
          `[webhook] underpayment on ${reference}: charged ${paidAmount}, expected >= ${expectedCharge}`
        )
        const adminPhone = process.env.ADMIN_PHONE
        if (adminPhone) {
          void sendWhatsAppWithFallback({
            to: adminPhone,
            message:
              `⚠️ Payment shortfall on order ${pending.order_number}\n` +
              `Charged: ₦${Math.round((Number.isFinite(paidAmount) ? paidAmount : 0) / 100)}\n` +
              `Expected at least: ₦${Math.round(expectedCharge / 100)}\n` +
              `Order NOT marked paid. Manual review needed.`,
          }).catch(() => {})
        }
        await recordSecurityEvent({
          eventType: 'webhook_reject', severity: 'warn', surface: 'paystack_webhook',
          detail: { reason: 'payment_shortfall', order: pending.order_number, charged: paidAmount, expected: expectedCharge },
        })
        break
      }
      if (paidAmount > expectedCharge) {
        // Overpayment = customer-borne Paystack fees; platform still nets the
        // order total. Informational only — proceed to mark the order paid.
        console.info(`[webhook] ${reference}: charged ${paidAmount} vs net ${expectedCharge} (customer bore ₦${Math.round((paidAmount - expectedCharge) / 100)} fees)`)
      }

      // SPLIT: the card remainder is confirmed — debit the wallet portion now.
      // This is the single commit point for split orders, so an abandoned
      // checkout never touched the wallet. If the wallet can no longer cover its
      // part (spent elsewhere since checkout) we must not half-pay the order:
      // refund the card remainder, cancel, and alert — never mark it paid.
      if (pending.payment_method === 'SPLIT' && walletPortion > 0 && pending.customer_id) {
        let splitOk = false
        try {
          const reservation = await findWalletReservationByOrder(pending.id)
          if (reservation?.status === 'ACTIVE') {
            await consumeWalletReservation({
              reservationId: reservation.id,
              idempotencyKey: `wallet-consume:${pending.id}`,
              actorType: 'system',
              actorId: null,
              correlationId: null,
              metadata: { order_number: pending.order_number, payment_method: 'SPLIT' },
            })
            splitOk = true
          } else {
            const spend = await spendCustomerWallet({
              customerId:  pending.customer_id,
              amountKobo:  walletPortion,
              orderId:     pending.id,
              orderNumber: pending.order_number,
              reference:   `CWUSE-${pending.id}`,
            })
            splitOk = spend.success
          }
        } catch (err) {
          console.error(`[webhook] split wallet settlement error on ${reference}:`, err)
        }

        if (!splitOk) {
          let refundOk = true
          try {
            await refundTransaction(reference, paidAmount)
          } catch (refundErr) {
            refundOk = false
            console.error(`[webhook] split refund failed on ${reference}:`, refundErr)
          }
          await db
            .from('orders')
            .update({ status: 'CANCELLED', order_state: 'cancelled', payment_status: 'FAILED', updated_at: new Date().toISOString() })
            .eq('id', pending.id)
            .eq('payment_status', 'PENDING')
          // Idempotency: don't insert a second refund row if this split-failure
          // was already recorded for this order+reference (a reprocess after the
          // route-level dedup is bypassed). Kept as a direct system insert by
          // decision; FUTURE: unify through reserve_order_refund() for the
          // order-lock + cumulative cap.
          const { data: priorRefund } = await db
            .from('refunds')
            .select('id')
            .eq('order_id', pending.id)
            .eq('paystack_transaction_reference', reference)
            .maybeSingle()
          if (!priorRefund) {
            await db.from('refunds').insert({
              order_id:                       pending.id,
              paystack_transaction_reference: reference,
              amount_kobo:                    paidAmount,
              reason:                         'Split payment: wallet portion could not be debited',
              status:                         refundOk ? 'PROCESSING' : 'NEEDS_ATTENTION',
              triggered_by:                   'SYSTEM_WEBHOOK',
            })
          }
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
            : { payment_status: 'PAID', status: 'PENDING', pending_since: nowIso, placed_at: nowIso, order_state: 'placed', updated_at: nowIso },
        )
        .eq('paystack_reference', reference)
        .eq('payment_status', 'PENDING')
        .select('id, order_number, vendor_id, customer_id, total_amount, subtotal')
        .single()

      if (error || !order) break

      await finalizeOrderPaymentIntent(db, {
        orderId: order.id as string,
        providerPayload: {
          reference,
          verified_amount_kobo: paidAmount,
          verified_currency: directPayment.verifiedCurrency ?? 'NGN',
          verified_environment: directPayment.verifiedEnvironment ?? 'test',
          verified_transaction_id: directPayment.verifiedTransactionId,
        },
      })

      await sendOrderConfirmationEmail(db, { orderId: order.id as string })

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

        // In-app bell + Web Push (card-paid path) — same alert the wallet-paid
        // path fires in app/api/orders/route.ts.
        const title = 'New order! 🛎️'
        const body = `${itemsSummary || 'A new order'} — ₦${Math.round((order.total_amount as number) / 100).toLocaleString('en-NG')} (${order.order_number}).`
        await notifyInApp({ userId: order.vendor_id as string, userType: 'VENDOR', title, body, link: '/vendor-dashboard' })
        void sendPushToUser(order.vendor_id as string, { title, body, url: '/vendor-dashboard', tag: `neworder-${order.order_number}` })
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
      const metadata = (data.metadata as Record<string, unknown>) ?? {}

      if ((metadata.type as string) === 'PREMIUM_SUBSCRIPTION' || (metadata.type as string) === 'BOOST_PURCHASE') {
        await processPremiumOrBoostWebhook('charge.failed', data)
        break
      }
      // Guard the transition: only cancel an order that is still awaiting its
      // first payment. Without the payment_status + status filter, a late or
      // replayed charge.failed could clobber an order that had already been paid
      // and progressed (e.g. VENDOR_ACCEPTED), wrongly cancelling it. A failed
      // top-up/subscription charge has no matching order row, so it no-ops here.
      const { data: order } = await db
        .from('orders')
        .update({ payment_status: 'FAILED', status: 'CANCELLED', order_state: 'cancelled', updated_at: new Date().toISOString() })
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
      const orderRef = (data.transaction_reference as string) ?? ''
      const { data: candidates } = await db.from('refunds')
        .select('id, paystack_refund_reference, amount_kobo, created_at')
        .eq('paystack_transaction_reference', orderRef)
        .eq('status', 'PROCESSING')
        .order('created_at', { ascending: true })
      const chosen = chooseRefundWebhookTarget((candidates ?? []) as RefundWebhookCandidate[], data)
      if (!chosen.refundId) {
        await recordSecurityEvent({
          eventType: 'webhook_reject', severity: chosen.ambiguous ? 'critical' : 'warn', surface: 'paystack_webhook',
          outcome: 'refund_event_not_applied',
          detail: { reason: chosen.reason, transaction_reference: orderRef },
        })
        break
      }
      const providerRefundReference = String(data.refund_reference ?? data.reference ?? data.id ?? '').trim()
      const completedUpdate: Record<string, unknown> = {
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      }
      if (providerRefundReference) completedUpdate.paystack_refund_reference = providerRefundReference
      await db
        .from('refunds')
        .update(completedUpdate)
        .eq('id', chosen.refundId)

      // Notify customer
      const { data: refund } = await db
        .from('refunds')
        .select('order_id, amount_kobo')
        .eq('id', chosen.refundId)
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
                amount: refundNaira(refund.amount_kobo),
                order_number: order.order_number as string,
              }),
            }).catch(() => {})
          }
        }
      }
      break
    }

    case 'refund.failed': {
      const orderRef = (data.transaction_reference as string) ?? ''
      const { data: candidates } = await db.from('refunds')
        .select('id, paystack_refund_reference, amount_kobo, created_at')
        .eq('paystack_transaction_reference', orderRef)
        .eq('status', 'PROCESSING')
        .order('created_at', { ascending: true })
      const chosen = chooseRefundWebhookTarget((candidates ?? []) as RefundWebhookCandidate[], data)
      if (!chosen.refundId) {
        await recordSecurityEvent({
          eventType: 'webhook_reject', severity: chosen.ambiguous ? 'critical' : 'warn', surface: 'paystack_webhook',
          outcome: 'refund_event_not_applied',
          detail: { reason: chosen.reason, transaction_reference: orderRef },
        })
        break
      }
      const providerRefundReference = String(data.refund_reference ?? data.reference ?? data.id ?? '').trim()
      const failedUpdate: Record<string, unknown> = {
        status: 'FAILED',
        failure_reason: (data.reason as string) ?? 'Unknown',
      }
      if (providerRefundReference) failedUpdate.paystack_refund_reference = providerRefundReference
      await db
        .from('refunds')
        .update(failedUpdate)
        .eq('id', chosen.refundId)

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

    case 'dedicatedaccount.assign.success':
    case 'assigndedicatedaccount.success': {
      const accountNumber = dedicatedAccountNumber(data)
      const customer = (data.customer as Record<string, unknown> | undefined) ?? {}
      const bank = (data.bank as Record<string, unknown> | undefined) ?? {}
      const customerCode = String(customer.customer_code ?? data.customer_code ?? '')
      if (!accountNumber || !customerCode) break
      await db.from('customer_virtual_accounts').update({
        status: 'ACTIVE', account_number: accountNumber,
        account_name: String(data.account_name ?? ''),
        bank_name: String(bank.name ?? data.bank_name ?? ''),
        provider_slug: String(bank.slug ?? data.provider_slug ?? ''),
        failure_reason: null, updated_at: new Date().toISOString(),
      }).eq('paystack_customer_code', customerCode).in('status', ['PENDING', 'PROVISIONING', 'FAILED'])
      break
    }

    case 'dedicatedaccount.assign.failed':
    case 'assigndedicatedaccount.failed':
    case 'customeridentification.failed': {
      const customer = (data.customer as Record<string, unknown> | undefined) ?? {}
      const customerCode = String(customer.customer_code ?? data.customer_code ?? '')
      if (!customerCode) break
      await db.from('customer_virtual_accounts').update({
        status: 'FAILED', failure_reason: String(data.message ?? 'Provider assignment failed').slice(0, 300),
        updated_at: new Date().toISOString(),
      }).eq('paystack_customer_code', customerCode).in('status', ['PENDING', 'PROVISIONING'])
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

  // Re-verify the charge with Paystack and use the VERIFIED settled amount —
  // NEVER trust metadata.amount (a client could inflate recorded revenue, or pay
  // a token amount while claiming a full tier). Mirrors the order/top-up branches.
  let subscriptionAmount = 0
  try {
    const verified = await verifyPaystackTransaction(reference)
    if (verified.status !== 'success') {
      console.warn(`[webhook] subscription charge ${reference} not 'success' on verify — not crediting`)
      return
    }
    subscriptionAmount = Number(verified.amount)
  } catch (err) {
    console.error(`[webhook] subscription verify failed for ${reference} — not crediting:`, err)
    return
  }
  if (!Number.isFinite(subscriptionAmount) || subscriptionAmount <= 0) return

  const { data: vendor } = await db
    .from('vendors')
    .select('subscription_tier')
    .eq('id', vendorId)
    .single()

  if (!vendor) return

  // Idempotency (handler-level second layer): a reprocessed SUBSCRIPTION charge
  // must not double-book a period or double-count revenue. The 087
  // UNIQUE(paystack_reference) is the race backstop under this check.
  const { data: existingSub } = await db
    .from('vendor_subscriptions')
    .select('id')
    .eq('paystack_reference', reference)
    .maybeSingle()
  if (existingSub) {
    console.info(`[webhook] subscription ${reference} already recorded — skipping (idempotent)`)
    return
  }

  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

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

function paystackEnvironmentFromSecret(secret: string | undefined): 'test' | 'production' {
  return secret?.startsWith('sk_live_') ? 'production' : 'test'
}

async function creditVerifiedDvaDeposit(params: {
  db: ReturnType<typeof createSupabaseAdmin>
  reference: string
  verified: Awaited<ReturnType<typeof verifyPaystackTransaction>>
  data: Record<string, unknown>
  virtualAccount: {
    id: string
    customer_id: string
    account_number: string | null
    account_name: string | null
    paystack_customer_code: string | null
    provider_slug: string | null
    bank_name: string | null
    status: string
  }
}): Promise<void> {
  const amountKobo = Number(params.verified.amount ?? 0)
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    throw new Error('Invalid verified DVA amount')
  }
  const currency = String(params.verified.metadata?.currency ?? params.data.currency ?? 'NGN').toUpperCase()
  if (currency !== 'NGN') {
    throw new Error(`Unsupported DVA currency: ${currency}`)
  }
  const environment = paystackEnvironmentFromSecret(process.env.PAYSTACK_SECRET_KEY)
  const accountNumber = dedicatedAccountNumber(params.data)
  if (!accountNumber || accountNumber !== params.virtualAccount.account_number) {
    throw new Error('DVA ownership could not be verified')
  }

  const [customerAvailableId, paystackReceivableId] = await Promise.all([
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'CUSTOMER_AVAILABLE',
      p_owner_type: 'CUSTOMER',
      p_owner_id: params.virtualAccount.customer_id,
      p_currency: currency,
      p_environment: environment,
      p_metadata: {
        source: 'dva_deposit',
        virtual_account_id: params.virtualAccount.id,
      },
    }),
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'PAYSTACK_RECEIVABLE',
      p_owner_type: 'PAYSTACK',
      p_owner_id: null,
      p_currency: currency,
      p_environment: environment,
      p_metadata: {
        source: 'dva_deposit',
        virtual_account_id: params.virtualAccount.id,
      },
    }),
  ])

  if (customerAvailableId.error) {
    throw new Error(`Could not ensure customer account: ${customerAvailableId.error.message}`)
  }
  if (paystackReceivableId.error) {
    throw new Error(`Could not ensure Paystack clearing account: ${paystackReceivableId.error.message}`)
  }

  const journalKey = `paystack:dva-deposit:${environment}:${params.reference}`
  const walletReference = `DVA-${environment}-${params.reference}`
  const posted = await params.db.rpc('post_ledger_journal', {
    p_journal_type: 'DVA_DEPOSIT',
    p_business_reference: params.reference,
    p_idempotency_key: journalKey,
    p_currency: currency,
    p_source: 'paystack_webhook',
    p_actor_type: 'system',
    p_actor_id: null,
    p_correlation_id: String(params.verified.reference ?? params.reference),
    p_metadata: {
      environment,
      paystack_reference: params.reference,
      paystack_transaction_id: params.data.id != null ? String(params.data.id) : null,
      customer_id: params.virtualAccount.customer_id,
      customer_virtual_account_id: params.virtualAccount.id,
      customer_code: params.virtualAccount.paystack_customer_code,
      account_number: accountNumber,
      account_name: params.virtualAccount.account_name,
      bank_name: params.virtualAccount.bank_name,
      provider_slug: params.virtualAccount.provider_slug,
      channel: String(params.data.channel ?? 'bank_transfer'),
      verified_at: new Date().toISOString(),
    },
    p_reversal_of_journal_id: null,
    p_entries: [
      {
        account_id: paystackReceivableId.data as string,
        side: 'DEBIT',
        amount_kobo: amountKobo,
        metadata: { flow: 'dva_deposit', reference: params.reference },
      },
      {
        account_id: customerAvailableId.data as string,
        side: 'CREDIT',
        amount_kobo: amountKobo,
        metadata: { flow: 'dva_deposit', reference: params.reference },
      },
    ],
  })

  if (posted.error) {
    throw new Error(`Could not post DVA deposit journal: ${posted.error.message}`)
  }

  const walletTopup = await params.db.rpc('topup_customer_wallet', {
    p_customer_id: params.virtualAccount.customer_id,
    p_amount_kobo: amountKobo,
    p_bonus_kobo: 0,
    p_reference: walletReference,
    p_description: `Verified DVA deposit from ${params.virtualAccount.bank_name ?? 'Paystack'}`,
  })
  if (walletTopup.error) {
    throw new Error(`Could not mirror DVA deposit to customer wallet: ${walletTopup.error.message}`)
  }
}
