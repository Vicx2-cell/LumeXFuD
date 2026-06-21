import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { refundOrderPayments } from '@/lib/order-refund'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { audit } from '@/lib/audit'

// Called every minute by Vercel cron.
// Hands SCHEDULED (prepaid) orders to their vendor once scheduled_release_at has
// arrived: SCHEDULED → PENDING (the normal vendor-accept lifecycle then runs).
// If the vendor is no longer active by then, the order is cancelled + fully
// refunded. Idempotent: every state flip is claimed with an optimistic lock on
// status = 'SCHEDULED', so a duplicate tick can't double-process.

interface SchedRow {
  id: string
  order_number: string
  vendor_id: string
  customer_id: string | null
  total_amount: number
  wallet_amount_kobo: number | null
  paystack_reference: string | null
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('release-scheduled', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const nowIso = new Date().toISOString()

  const { data: dueRaw, error } = await db
    .from('orders')
    .select('id, order_number, vendor_id, customer_id, total_amount, wallet_amount_kobo, paystack_reference')
    .eq('status', 'SCHEDULED')
    .eq('payment_status', 'PAID')
    .lte('scheduled_release_at', nowIso)
    .limit(50)

  if (error) {
    console.error('[cron/release-scheduled] DB error:', error.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const due = (dueRaw ?? []) as unknown as SchedRow[]
  if (due.length === 0) return NextResponse.json({ released: 0, cancelled: 0 })

  let released = 0
  let cancelled = 0
  let failed = 0

  for (const order of due) {
    try {
      // Is the vendor still able to take orders? (A currently-CLOSED vendor is
      // fine — they'll get a normal PENDING order to accept/decline; only an
      // inactive/deleted vendor forces an auto-cancel + refund.)
      const { data: vendorRow } = await db
        .from('vendors')
        .select('phone, shop_name, is_active, deleted_at')
        .eq('id', order.vendor_id)
        .maybeSingle()
      const vendor = vendorRow as { phone: string; shop_name: string; is_active: boolean; deleted_at: string | null } | null

      const vendorUnavailable = !vendor || !vendor.is_active || !!vendor.deleted_at

      // Customer phone for notifications.
      let customerPhone: string | null = null
      if (order.customer_id) {
        const { data: c } = await db.from('customers').select('phone').eq('id', order.customer_id).maybeSingle()
        customerPhone = (c as { phone?: string } | null)?.phone ?? null
      }

      if (vendorUnavailable) {
        // Claim then refund (optimistic lock keeps refund at-most-once).
        const { data: claimed } = await db
          .from('orders')
          .update({ status: 'CANCELLED', cancelled_at: nowIso, updated_at: nowIso })
          .eq('id', order.id)
          .eq('status', 'SCHEDULED')
          .select('id')
        if (!claimed || claimed.length === 0) continue // raced — skip

        const { walletOk, paystackOk } = await refundOrderPayments({
          order: {
            id:                 order.id,
            order_number:       order.order_number,
            customer_id:        order.customer_id,
            total_amount:       order.total_amount,
            wallet_amount_kobo: order.wallet_amount_kobo ?? 0,
            paystack_reference: order.paystack_reference,
          },
          reason:        'Scheduled order: vendor no longer available at delivery time',
          triggeredBy:   'SYSTEM_SCHEDULED_RELEASE',
          customerPhone: customerPhone ?? undefined,
        })
        if (walletOk && paystackOk) {
          await db.from('orders').update({ payment_status: 'REFUNDED', updated_at: nowIso }).eq('id', order.id)
        }
        if (customerPhone) {
          void sendWhatsAppWithFallback({
            to: customerPhone,
            message: `😔 Your scheduled order #${order.order_number} couldn't be placed — the vendor is unavailable. You've been fully refunded.`,
          }).catch(() => {})
        }
        cancelled++
        continue
      }

      // Hand to the vendor: SCHEDULED → PENDING, start the accept clock.
      const { data: promoted } = await db
        .from('orders')
        .update({ status: 'PENDING', pending_since: nowIso, updated_at: nowIso })
        .eq('id', order.id)
        .eq('status', 'SCHEDULED')
        .select('id')
      if (!promoted || promoted.length === 0) continue // raced — skip

      // Notify vendor (mirrors the immediate-order path).
      const { data: items } = await db
        .from('order_items')
        .select('name, quantity')
        .eq('order_id', order.id)
      const itemsSummary = (items ?? [])
        .map((i: { name: string; quantity: number }) => `${i.name} x${i.quantity}`)
        .join(', ')

      void sendWhatsAppWithFallback({
        to: vendor!.phone,
        message: renderTemplate('ORDER_PENDING', {
          order_number: order.order_number,
          total: Math.round(order.total_amount / 100),
          customer_first_name: 'Customer',
          items_summary: itemsSummary,
          dashboard_url: `${appUrl}/vendor-dashboard`,
        }),
      }).catch(() => {})

      if (customerPhone) {
        void sendWhatsAppWithFallback({
          to: customerPhone,
          message: `👨‍🍳 Your scheduled order #${order.order_number} is now being sent to ${vendor!.shop_name}. Track it: ${appUrl}/order/${order.order_number}`,
        }).catch(() => {})
      }

      void audit({
        actor_id: 'SYSTEM',
        actor_role: 'admin',
        action: 'scheduled_order_released',
        target_table: 'orders',
        target_id: order.id,
        new_value: { order_number: order.order_number },
      })

      released++
    } catch (err) {
      console.error(`[cron/release-scheduled] failed for ${order.order_number}:`, err)
      failed++
    }
  }

  return NextResponse.json({ released, cancelled, failed })
}
