import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import {
  creditWalletHeld,
  formatPrice,
} from '@/lib/wallet'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { completeOrderPayout } from '@/lib/order-payout'
import { getPayoutsMode } from '@/lib/controls'
import { emailCommittedOrderStatus } from '@/lib/order-status-email'

// Called every minute by Vercel cron.
// Finds DELIVERED orders whose 15-min dispute window has passed,
// credits both vendor and rider wallets (as HOLD transactions),
// checks rider milestone bonuses,
// then marks the order COMPLETED.

interface OrderRow {
  id: string
  order_number: string
  vendor_id: string
  rider_id: string
  subtotal: number
  rider_delivery_cut: number
  tip_amount: number
  delivered_at: string | null
  created_at: string
}

interface RiderRow { id: string; phone: string; full_name: string; total_deliveries: number }

interface PayoutRow {
  id: string
  order_number: string
  vendor_id: string | null
  rider_id: string | null
  subtotal: number
  rider_delivery_cut: number
  tip_amount: number
}

// ─── Milestone bonus helpers ──────────────────────────────────────────────────

interface MilestoneBonus {
  milestone: string
  amount_kobo: number
  message: string
}

async function getRiderMilestoneBonuses(
  db: ReturnType<typeof createSupabaseAdmin>,
  riderId: string,
  newTotalDeliveries: number,
  deliveredAt: Date,
  settings: Map<string, number>
): Promise<MilestoneBonus[]> {
  const bonuses: MilestoneBonus[] = []

  // Check 50-delivery milestone
  if (newTotalDeliveries === 50) {
    const amount = settings.get('rider_bonus_50_kobo') ?? 50_000
    bonuses.push({
      milestone: '50_deliveries',
      amount_kobo: amount,
      message: `🎉 Milestone! 50 deliveries completed. ${formatPrice(amount)} bonus added to your wallet!`,
    })
  }

  // Check 100-delivery milestone
  if (newTotalDeliveries === 100) {
    const amount = settings.get('rider_bonus_100_kobo') ?? 100_000
    bonuses.push({
      milestone: '100_deliveries',
      amount_kobo: amount,
      message: `🏆 Milestone! 100 deliveries completed. ${formatPrice(amount)} bonus added to your wallet!`,
    })
  }

  // Check Sunday delivery bonus (every Sunday)
  const dayOfWeek = deliveredAt.getDay() // 0 = Sunday
  if (dayOfWeek === 0) {
    const amount = settings.get('rider_sunday_bonus_kobo') ?? 5_000
    bonuses.push({
      milestone: `sunday_${deliveredAt.toISOString().split('T')[0]}`,
      amount_kobo: amount,
      message: `☀️ Sunday delivery bonus! ${formatPrice(amount)} added to your wallet.`,
    })
  }

  if (bonuses.length === 0) return []

  // Filter out already-awarded milestones (idempotency)
  const milestoneKeys = bonuses.map((b) => b.milestone)
  const { data: existing } = await db
    .from('rider_milestone_bonuses')
    .select('milestone')
    .eq('rider_id', riderId)
    .in('milestone', milestoneKeys)

  const awarded = new Set(((existing ?? []) as Array<{ milestone: string }>).map((r) => r.milestone))
  return bonuses.filter((b) => !awarded.has(b.milestone))
}

async function awardMilestoneBonus(
  db: ReturnType<typeof createSupabaseAdmin>,
  riderId: string,
  riderPhone: string,
  bonus: MilestoneBonus
): Promise<void> {
  // Insert milestone record first (idempotency guard via upsert ignoreDuplicates)
  const { error: milestoneErr } = await db
    .from('rider_milestone_bonuses')
    .upsert(
      { rider_id: riderId, milestone: bonus.milestone, amount_kobo: bonus.amount_kobo },
      { onConflict: 'rider_id, milestone', ignoreDuplicates: true }
    )

  if (milestoneErr) {
    console.error(`[milestone] Failed to record milestone for ${riderId}:`, milestoneErr.message)
    return
  }

  // Credit wallet (immediate release — no hold period for bonuses)
  await creditWalletHeld({
    userId:      riderId,
    userType:    'RIDER',
    amount:      bonus.amount_kobo,
    orderId:     riderId, // no specific order, use rider id as placeholder
    description: `🏆 Milestone bonus: ${bonus.milestone.replace(/_/g, ' ')}`,
    releaseAt:   new Date(), // immediate release
    reference:   `BONUS-${riderId.slice(0, 8)}-${bonus.milestone}`,
  })

  // WhatsApp notification
  sendWhatsAppWithFallback({ to: riderPhone, message: bonus.message }).catch(() => {})
}

async function getSettings(db: ReturnType<typeof createSupabaseAdmin>): Promise<Map<string, number>> {
  const keys = [
    'rider_bonus_50_kobo', 'rider_bonus_100_kobo',
    'rider_bonus_300_monthly_kobo', 'rider_sunday_bonus_kobo',
  ]
  // settings table: id TEXT PK, value JSONB {"amount_kobo": N}
  const { data } = await db.from('settings').select('id, value').in('id', keys)
  const map = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>) {
    map.set(row.id, Number(row.value?.amount_kobo ?? 0))
  }
  return map
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('release-payments', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Payouts kill switch ───────────────────────────────────────────────────
  // The single enforcement point for `payouts.mode` (LumeX Control spec). `auto`
  // is the only state that releases funds. `manual`/`frozen` stop ALL crediting —
  // including the self-heal pass — so an emergency freeze means zero funds move.
  // Fails CLOSED: if controls are unreadable, getPayoutsMode() returns 'frozen'.
  const payoutsMode = await getPayoutsMode()
  if (payoutsMode !== 'auto') {
    return NextResponse.json({ skipped: true, reason: `payouts ${payoutsMode}`, processed: 0, healed: 0 })
  }

  const db = createSupabaseAdmin()

  // ── Self-heal pass ──────────────────────────────────────────────────────────
  // Orders that reached COMPLETED but whose wallet was never released: the credit
  // failed at completion time (e.g. the credit_wallet_held ON CONFLICT erroring
  // on a missing unique index) and completeOrderPayout unwound wallet_released to
  // false. Retry them every tick — completeOrderPayout is idempotent (claims
  // wallet_released atomically), so once the underlying cause is fixed these
  // self-credit on the next run instead of stranding the vendor/rider forever.
  let healed = 0
  const { data: strandedRaw } = await db
    .from('orders')
    .select('id, order_number, vendor_id, rider_id, subtotal, rider_delivery_cut, tip_amount')
    .eq('status', 'COMPLETED')
    .eq('wallet_released', false)
    .limit(50)
  for (const o of (strandedRaw ?? []) as Array<PayoutRow>) {
    try {
      await completeOrderPayout({
        id: o.id, order_number: o.order_number,
        vendor_id: o.vendor_id, rider_id: o.rider_id,
        subtotal: Number(o.subtotal) || 0,
        rider_delivery_cut: Number(o.rider_delivery_cut) || 0,
        tip_amount: Number(o.tip_amount) || 0,
      })
      healed++
    } catch (err) {
      console.error(`[cron/release-payments] self-heal failed for ${o.order_number}:`, err)
    }
  }

  // Find DELIVERED orders ready for wallet crediting (15-min window has passed)
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data: ordersRaw, error } = await db
    .from('orders')
    .select('id, order_number, vendor_id, rider_id, subtotal, rider_delivery_cut, tip_amount, delivered_at, created_at')
    .eq('status', 'DELIVERED')
    .eq('wallet_released', false)
    .lte('delivered_at', fifteenMinAgo)
    .not('rider_id', 'is', null)
    .limit(50)

  if (error) {
    console.error('[cron/release-payments] DB error:', error.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const orders = (ordersRaw ?? []) as unknown as OrderRow[]
  if (orders.length === 0) {
    return NextResponse.json({ processed: 0, healed })
  }

  // Prefetch non-settlement settings once. Order settlement itself is delegated
  // to completeOrderPayout, the sole owner of commission/promotion deductions.
  const settings = await getSettings(db)

  let processed = 0
  let failed = 0

  for (const order of orders) {
    try {
      const deliveredAt = order.delivered_at ? new Date(order.delivered_at) : new Date()

      const riderAmount  = Number(order.rider_delivery_cut) + Number(order.tip_amount)

      // Claim completion before moving money. completeOrderPayout then atomically
      // claims wallet_released and calculates both credits from immutable order
      // snapshots, including commission and vendor-funded promotion deductions.
      const { data: completedRows } = await db
        .from('orders')
        .update({
          status:          'COMPLETED',
          completed_at:    new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('status', 'DELIVERED') // optimistic lock
        .select('id')

      if (!completedRows || completedRows.length === 0) {
        // Order status changed concurrently — skip silently
        continue
      }

      await completeOrderPayout({
        id: order.id,
        order_number: order.order_number,
        vendor_id: order.vendor_id,
        rider_id: order.rider_id,
        subtotal: Number(order.subtotal) || 0,
        rider_delivery_cut: Number(order.rider_delivery_cut) || 0,
        tip_amount: Number(order.tip_amount) || 0,
      })

      // ── Rider wallet notification + milestone check ─────────────────────────
      await emailCommittedOrderStatus(db, {
        orderId: order.id,
        status: 'COMPLETED',
        actorType: 'system',
        actorId: 'SYSTEM_RELEASE_PAYMENTS',
      })

      if (riderAmount > 0) {
        const { data: riderRow } = await db
          .from('riders')
          .select('phone, total_deliveries')
          .eq('id', order.rider_id)
          .maybeSingle()
        const rider = riderRow as unknown as Pick<RiderRow, 'phone' | 'total_deliveries'> | null

        if (rider?.phone) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
          sendWhatsAppWithFallback({
            to: rider.phone,
            message: `${formatPrice(riderAmount)} added to your LumeX payouts for order #${order.order_number}.\nYour payout page shows when held earnings become withdrawable.\n${appUrl}/rider/wallet`,
          }).catch(() => {})

          // ── Check milestone bonuses ─────────────────────────────────────────
          const newTotalDeliveries = Number(rider.total_deliveries ?? 0)
          try {
            const milestoneBonuses = await getRiderMilestoneBonuses(
              db, order.rider_id, newTotalDeliveries, deliveredAt, settings
            )
            for (const bonus of milestoneBonuses) {
              await awardMilestoneBonus(db, order.rider_id, rider.phone, bonus)
            }
          } catch (milestoneErr) {
            // Non-fatal — earnings already credited
            console.error('[milestone] Error checking bonuses:', milestoneErr)
          }
        }
      }

      processed++
    } catch (err) {
      console.error(`[cron/release-payments] Failed for order ${order.id}:`, err)
      failed++
    }
  }

  return NextResponse.json({ processed, failed, healed })
}
