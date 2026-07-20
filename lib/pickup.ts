import { createSupabaseAdmin } from './supabase/server'
import { completeOrderPayout } from './order-payout'
import { recordOrderCompletedEarnings, recordPlatformEarning } from './platform-earnings'
import { refundOrderPayments } from './order-refund'
import { refundToCustomerWallet } from './customer-wallet'
import { sendWhatsAppWithFallback } from './notify'
import { emailCommittedOrderStatus } from './order-status-email'

// ─── Pickup (Order Ahead) shared logic ───────────────────────────────────────
// Skip-the-queue flow: pay upfront → 6-char HASHED handover code (see
// lib/handover-code.ts) → vendor enters the customer's code to release funds.
// No riders, ₦0 delivery, dynamic platform fee. See migrations 072 + 073.
//
// THE 1h25m CLOCK (Invariant I7): the customer-facing FORFEIT window runs from
// when the food is READY (orders.ready_at) — the customer is never charged for the
// vendor's prep time. A SEPARATE fairness window runs from payment (pending_since):
// if the vendor accepts but never makes the order ready in time, the customer is
// auto-refunded (a vendor-side fail, not a customer no-show). Both are derived
// server-side from timestamps the existing flow already writes, so the Paystack
// webhook is NOT modified (Invariant I6).

export interface PickupConfig {
  holdMinutes: number          // the 1h25m (85-min) forfeit window from payment
  strikeLimit: number          // no-shows before pickup is suspended for a customer
  firstNoShowGoodwill: boolean // refund the platform fee on a customer's first no-show
}

const DEFAULT_HOLD_MIN = 85
const DEFAULT_STRIKE_LIMIT = 3

export async function getPickupConfig(
  db: ReturnType<typeof createSupabaseAdmin> = createSupabaseAdmin(),
): Promise<PickupConfig> {
  const { data } = await db
    .from('settings')
    .select('id, value')
    .in('id', ['pickup_hold_minutes', 'pickup_noshow_strike_limit', 'pickup_first_noshow_goodwill'])

  const map = new Map((data ?? []).map((r) => [String((r as { id: string }).id), (r as { value: unknown }).value]))
  const hold = Number((map.get('pickup_hold_minutes') as { minutes?: number } | undefined)?.minutes)
  const lim  = Number((map.get('pickup_noshow_strike_limit') as { count?: number } | undefined)?.count)
  const gw   = Boolean((map.get('pickup_first_noshow_goodwill') as { enabled?: boolean } | undefined)?.enabled)

  return {
    holdMinutes: Number.isFinite(hold) && hold > 0 ? hold : DEFAULT_HOLD_MIN,
    strikeLimit: Number.isFinite(lim) && lim > 0 ? lim : DEFAULT_STRIKE_LIMIT,
    firstNoShowGoodwill: gw,
  }
}

/**
 * Pacing: with a per-vendor concurrency cap, the kitchen never stacks. The first
 * `maxConcurrent` in-flight pickup orders promise ready in one prep cycle; each
 * full batch beyond that pushes the promised ready time out by another prep cycle.
 * maxConcurrent <= 0 disables pacing (always one prep cycle).
 */
export function computePickupEta(
  now: Date,
  prepMinutes: number,
  activeCount: number,
  maxConcurrent: number,
): Date {
  const prep = Math.max(1, prepMinutes)
  if (maxConcurrent <= 0) return new Date(now.getTime() + prep * 60_000)
  const batchesAhead = Math.floor(activeCount / maxConcurrent)
  return new Date(now.getTime() + prep * (1 + batchesAhead) * 60_000)
}

/** Count a vendor's currently in-flight pickup orders (for the pacing calc). */
export async function countActivePickups(
  db: ReturnType<typeof createSupabaseAdmin>,
  vendorId: string,
): Promise<number> {
  const { count } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('vendor_id', vendorId)
    .eq('delivery_type', 'PICKUP')
    .in('status', ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY'])
  return count ?? 0
}

interface DuePickup {
  id: string
  order_number: string
  vendor_id: string | null
  subtotal: number
  platform_markup: number
  total_amount: number
  wallet_amount_kobo: number | null
  paystack_reference: string | null
  customer_id: string | null
  status: string
  ready_at: string | null
  pending_since: string | null
}

/** Add a no-show strike to a customer and suspend pickup once the limit is hit. */
async function addNoShowStrike(
  db: ReturnType<typeof createSupabaseAdmin>,
  customerId: string,
  limit: number,
): Promise<number> {
  const { data } = await db.from('customers').select('pickup_strikes').eq('id', customerId).maybeSingle()
  const next = (Number((data as { pickup_strikes?: number } | null)?.pickup_strikes) || 0) + 1
  await db.from('customers')
    .update({ pickup_strikes: next, pickup_banned: next >= limit })
    .eq('id', customerId)
  return next
}

async function customerPhone(
  db: ReturnType<typeof createSupabaseAdmin>,
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null
  const { data } = await db.from('customers').select('phone').eq('id', customerId).maybeSingle()
  return (data as { phone?: string } | null)?.phone ?? null
}

/**
 * Settle overdue pickup orders. Two independent clocks keep the money conserved
 * (Invariant I1) and fair:
 *
 *   • FORFEIT — a READY order uncollected past ready_at + holdMinutes → NO_SHOW.
 *     The vendor cooked it, so the vendor KEEPS the payment (food → held balance,
 *     platform keeps its fee). The customer forfeits and takes a strike. Reuses
 *     completeOrderPayout (idempotent). The clock starts at READY, never at payment.
 *
 *   • FAIRNESS — a still-not-ready order past pending_since + holdMinutes (vendor
 *     slow / out of stock / power cut) → CANCELLED with a FULL auto-refund through
 *     the existing rails (refundOrderPayments). VENDOR-side fail, so the customer
 *     is NOT struck. No payout was ever made → nothing to claw back.
 *
 * Scoped to one vendor when `vendorId` is given (cheap from a hot path), otherwise
 * a small global sweep for the cron. Never throws.
 */
export async function settleDuePickups(vendorId?: string): Promise<number> {
  const db = createSupabaseAdmin()
  const cfg = await getPickupConfig(db)
  const now = new Date()
  const cutoffIso = new Date(now.getTime() - cfg.holdMinutes * 60_000).toISOString()
  const nowIso = now.toISOString()
  const SEL = 'id, order_number, vendor_id, subtotal, platform_markup, total_amount, wallet_amount_kobo, paystack_reference, customer_id, status, ready_at, pending_since'

  // FORFEIT candidates: READY past ready_at + hold (clock starts at READY).
  let qForfeit = db.from('orders').select(SEL)
    .eq('delivery_type', 'PICKUP').eq('status', 'READY')
    .not('ready_at', 'is', null).lte('ready_at', cutoffIso).limit(25)
  // FAIRNESS candidates: accepted but never made ready, past pending_since + hold.
  let qFairness = db.from('orders').select(SEL)
    .eq('delivery_type', 'PICKUP').in('status', ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING'])
    .not('pending_since', 'is', null).lte('pending_since', cutoffIso).limit(25)
  if (vendorId) { qForfeit = qForfeit.eq('vendor_id', vendorId); qFairness = qFairness.eq('vendor_id', vendorId) }

  const [{ data: forfeitRows }, { data: fairnessRows }] = await Promise.all([qForfeit, qFairness])
  const candidates: Array<{ o: DuePickup; reachedReady: boolean }> = [
    ...((forfeitRows ?? []) as DuePickup[]).map((o) => ({ o, reachedReady: true })),
    ...((fairnessRows ?? []) as DuePickup[]).map((o) => ({ o, reachedReady: false })),
  ]
  let settled = 0

  for (const { o, reachedReady } of candidates) {
    try {
      if (reachedReady) {
        // ── Forfeit: claim READY → NO_SHOW so only one caller settles it ──────────
        const { data: claimed } = await db
          .from('orders')
          .update({ status: 'NO_SHOW', order_state: 'cancelled', no_show_at: nowIso, handover_code_hash: null, updated_at: nowIso })
          .eq('id', o.id)
          .eq('status', 'READY')
          .select('id')
        if (!claimed || claimed.length === 0) continue

        // Vendor keeps payment (food → held balance; platform keeps its fee).
        void recordOrderCompletedEarnings({
          order_id:             o.id,
          platform_markup_kobo: Number(o.platform_markup) || 0,
          delivery_cut_kobo:    0,
          order_number:         o.order_number,
        })
        await completeOrderPayout({
          id: o.id, order_number: o.order_number,
          vendor_id: o.vendor_id, rider_id: null,
          subtotal: Number(o.subtotal) || 0, rider_delivery_cut: 0, tip_amount: 0,
        })
        settled++

        // Strike the customer; optional first-no-show goodwill (default OFF).
        if (o.customer_id) {
          const strikes = await addNoShowStrike(db, o.customer_id, cfg.strikeLimit)
          if (cfg.firstNoShowGoodwill && strikes === 1 && (Number(o.platform_markup) || 0) > 0) {
            const fee = Number(o.platform_markup)
            const ok = await refundToCustomerWallet({
              customerId: o.customer_id, amountKobo: fee, orderId: o.id,
              reference: `GOODWILL-${o.id}`, reason: 'First no-show goodwill (platform fee)',
            })
            // The platform gives back its OWN fee — record the cost so the ledger balances.
            if (ok) void recordPlatformEarning({ type: 'REFUND_COST', amount_kobo: -fee, order_id: o.id, description: `Goodwill fee refund — ${o.order_number}` })
          }
        }

        const phone = await customerPhone(db, o.customer_id)
        if (phone) void sendWhatsAppWithFallback({
          to: phone,
          message: `⌛ Your pickup order #${o.order_number} wasn't collected in time, so it's now closed. As it was prepared for you, it isn't refundable. Order again any time!`,
        }).catch(() => {})
      } else {
        // ── Vendor-side fail: claim <status> → CANCELLED, then full refund ────────
        const { data: claimed } = await db
          .from('orders')
          .update({ status: 'CANCELLED', order_state: 'cancelled', auto_cancel_reason: 'pickup_fairness', cancelled_at: nowIso, handover_code_hash: null, payment_status: 'REFUNDED', updated_at: nowIso })
          .eq('id', o.id)
          .eq('status', o.status)
          .select('id')
        if (!claimed || claimed.length === 0) continue

        const { walletOk, paystackOk } = await refundOrderPayments({
          order: {
            id: o.id, order_number: o.order_number, customer_id: o.customer_id,
            total_amount: Number(o.total_amount) || 0,
            wallet_amount_kobo: o.wallet_amount_kobo, paystack_reference: o.paystack_reference,
          },
          reason: 'Pickup not ready in time — vendor could not fulfil',
          triggeredBy: 'system:pickup-fairness',
        })
        await emailCommittedOrderStatus(db, {
          orderId: o.id,
          status: walletOk && paystackOk ? 'REFUNDED' : 'CANCELLED',
          actorType: 'system',
          actorId: 'system:pickup-fairness',
        })
        settled++

        const phone = await customerPhone(db, o.customer_id)
        if (phone) void sendWhatsAppWithFallback({
          to: phone,
          message: `😔 Sorry — your pickup order #${o.order_number} couldn't be prepared in time, so we've cancelled it and refunded you in full. Please try again.`,
        }).catch(() => {})
      }
    } catch (err) {
      console.error(`[pickup] settle failed for ${o.order_number}:`, err)
    }
  }
  return settled
}

// Back-compat alias: the cron + hot paths used to call settleDuePickupNoShows.
export const settleDuePickupNoShows = settleDuePickups
