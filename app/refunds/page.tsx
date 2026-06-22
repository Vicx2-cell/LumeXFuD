import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/money'
import { SiteFooter, SUPPORT_EMAIL } from '@/components/site-footer'

export const dynamic = 'force-dynamic'

// Public Refund & Cancellation Policy. Card networks require customers to know
// how refunds work BEFORE paying — this consolidates every refund path (cancel,
// delivery dispute, pickup no-show, vendor failure, failed payment) on one page,
// and shows the live fees so pricing is transparent without logging in.
export default async function RefundsPage() {
  const db = createSupabaseAdmin()
  // Live fees from the settings table — id-keyed JSONB shaped {"amount_kobo": N},
  // the SAME source the cart + the authoritative checkout calc use. A super-admin
  // price change here is reflected on this page immediately (no hardcoded prices).
  const { data } = await db.from('settings').select('id, value')
    .in('id', ['platform_markup', 'delivery_fee_bike', 'delivery_fee_door', 'min_order_amount'])
  const priceMap = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>) {
    priceMap.set(row.id, Number(row.value?.amount_kobo))
  }
  const kobo = (id: string, fallback: number) => {
    const n = priceMap.get(id)
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback
  }
  const platform = kobo('platform_markup', 25000)
  const bike = kobo('delivery_fee_bike', 50000)
  const door = kobo('delivery_fee_door', 100000)
  const minOrder = kobo('min_order_amount', 50000)

  return (
    <main style={{ background: '#0A0A0B' }}>
      <div className="min-h-dvh px-5 py-12 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2 text-white">Refund &amp; Cancellation Policy</h1>
        <p className="text-sm text-white/40 mb-8">Last updated: June 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-white/70">
          <section>
            <p>LumeX Fud is a campus food delivery service for Abia State University (ABSU). When you place an order you pay for your food, a flat platform fee, and (for delivery) a flat delivery fee. All payments are digital and processed by Paystack — we never store your card details. This page explains exactly when you are and aren’t refunded.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">What you pay</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Food price (set by the vendor)</li>
              <li>Platform fee: <span className="text-white">{formatPrice(platform)}</span> flat per order (never a percentage)</li>
              <li>Bike delivery: <span className="text-white">{formatPrice(bike)}</span> · Door delivery: <span className="text-white">{formatPrice(door)}</span></li>
              <li>Pickup (collect it yourself): <span className="text-white">₦0 delivery</span> — only food + the platform fee</li>
              <li>Minimum order: <span className="text-white">{formatPrice(minOrder)}</span>. Tips (optional) go 100% to your rider.</li>
            </ul>
            <p className="mt-2 text-white/50">The full breakdown is always shown on the checkout screen before you pay.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Cancelling an order</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-white">If the vendor doesn’t accept your order in time</strong> (about 5 minutes), it is <strong className="text-white">automatically cancelled and refunded in full</strong> — you don’t need to do anything.</li>
              <li><strong className="text-white">Once a vendor accepts your order, it can’t be cancelled</strong>, because your food is being prepared. If something goes wrong, report a problem (below).</li>
              <li><strong className="text-white">Scheduled (order-ahead) orders</strong> can be cancelled for a full refund any time before they are sent to the vendor.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Delivery — problems with your order</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>When your order is delivered you confirm receipt in the app by giving your rider your private collection code.</li>
              <li>If something is wrong (missing items, wrong order, food not received), you can <strong className="text-white">report a problem within 24 hours</strong> of delivery from your order page.</li>
              <li>Our team reviews every report within 24 hours. Where the complaint is valid, you are refunded in full or in part based on the evidence.</li>
              <li>If a rider cannot complete a delivery and the order is returned, you are refunded for any part not delivered.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Pickup (Order Ahead) — collection window</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You pay upfront and the vendor cooks your order. Once it is marked <strong className="text-white">ready</strong>, it is held for you for <strong className="text-white">1 hour 25 minutes</strong>.</li>
              <li>You agree to this window with a tick box before you pay. <strong className="text-white">If you do not collect within that time, the order is cleared and your payment is not refunded</strong> — the food was prepared specially for you.</li>
              <li><strong className="text-white">If the vendor never marks your order ready</strong> (out of stock, too busy, etc.), you are <strong className="text-white">automatically refunded in full</strong>. That is never counted as a no-show against you.</li>
              <li>Running late? Contact the vendor (their number is on your order). Repeated no-shows may pause pickup on your account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Failed payments</h2>
            <p>If a payment fails or is not completed, no order is created and you are not charged. Any amount that was debited but not used for an order is returned to your original payment method or your LumeX Wallet.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">How &amp; when refunds are paid</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Refunds are always returned to <strong className="text-white">how you paid</strong>: card/bank/USSD refunds go back through Paystack to that same source; wallet payments are returned to your LumeX Wallet.</li>
              <li>Wallet refunds are usually instant. Paystack (card/bank) refunds are initiated immediately and typically reflect within a few business days, depending on your bank.</li>
              <li>Every refund is logged. If you don’t see an approved refund within 10 business days, contact us.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Need help?</h2>
            <p>Email <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#F5A623]">{SUPPORT_EMAIL}</a> with your order number, or use the support contact on your <a href="/contact" className="text-[#F5A623]">Contact</a> page. See also our <a href="/terms" className="text-[#F5A623]">Terms</a> and <a href="/privacy" className="text-[#F5A623]">Privacy Policy</a>.</p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  )
}
