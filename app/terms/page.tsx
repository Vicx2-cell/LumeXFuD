import { getControls } from '@/lib/controls'
import { formatHoursRange } from '@/lib/hours'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/money'
import { SiteFooter, SUPPORT_EMAIL } from '@/components/site-footer'

export const dynamic = 'force-dynamic'

export default async function TermsPage() {
  const controls = await getControls()
  const hoursLabel = formatHoursRange(controls.hours_open, controls.hours_close)
  // Minimum order — live from settings ({"amount_kobo": N}); never hardcoded.
  const db = createSupabaseAdmin()
  const { data: minRow } = await db.from('settings').select('value').eq('id', 'min_order_amount').maybeSingle()
  const minKobo = Number((minRow as { value?: { amount_kobo?: number } } | null)?.value?.amount_kobo)
  const minOrder = Number.isFinite(minKobo) && minKobo > 0 ? minKobo : 50000
  return (
    <main style={{ background: '#0A0A0B' }}>
      <div className="min-h-dvh px-5 py-12 max-w-2xl mx-auto" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 3rem)' }}>
      <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-white/40 mb-8">Last updated: June 2026</p>

      <div className="space-y-8 text-base leading-relaxed text-white/70 [overflow-wrap:anywhere]">
        <section>
          <h2 className="text-base font-semibold text-white mb-2">1. Acceptance of terms</h2>
          <p>By using LumeX Fud, you agree to these terms. LumeX Fud is a campus food delivery service operated by Lumex, serving students at Abia State University (ABSU), Nigeria. These terms, together with our <a href="/refunds" className="text-[#F5A623]">Refund &amp; Cancellation Policy</a> and <a href="/privacy" className="text-[#F5A623]">Privacy Policy</a>, govern your use of the service.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">2. Platform hours & service</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>LumeX Fud operates {hoursLabel} daily</li>
            <li>Minimum order is {formatPrice(minOrder)}</li>
            <li>Delivery is available only within ABSU campus</li>
            <li>We are not responsible for vendor food quality, only for delivery</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">3. Orders & payments</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>All payments are digital — no cash on delivery</li>
            <li>Orders are binding once payment is confirmed</li>
            <li>You may cancel before a vendor accepts (within 5 minutes of placing)</li>
            <li>Prices shown include platform fee and delivery fee</li>
            <li>We reserve the right to cancel orders in cases of fraud or error</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">4. Refunds, cancellations &amp; disputes</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>You can cancel for a full refund any time before the vendor accepts your order. Once the vendor accepts, the order can’t be cancelled (your food is being prepared) — report a problem instead. If the vendor never accepts in time (about 5 minutes), it is cancelled and refunded automatically</li>
            <li>For delivery, you may report a problem within <strong className="text-white">24 hours</strong> of receiving your order; our team reviews every report within 24 hours and refunds in full or in part based on the evidence</li>
            <li>For pickup, once your order is marked ready it is held for <strong className="text-white">1 hour 25 minutes</strong> — you agree to this before paying; if you don’t collect in time the order is cleared and not refunded. If the vendor never makes it ready, you are automatically refunded in full</li>
            <li>Refunds are returned to your original payment method (via Paystack) or your LumeX Wallet</li>
            <li>Abusing the dispute system may result in account suspension</li>
          </ul>
          <p className="mt-2">Full details: <a href="/refunds" className="text-[#F5A623]">Refund &amp; Cancellation Policy</a>.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">5. Prohibited conduct</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Placing fraudulent orders</li>
            <li>Harassing vendors, riders, or platform staff</li>
            <li>Sharing phone numbers or external contact details via platform messages</li>
            <li>Attempting to manipulate pricing or payments</li>
            <li>Creating multiple accounts to abuse promotions</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">6. Limitation of liability</h2>
          <p>LumeX is not liable for delays caused by vendor kitchen issues, extreme weather, or events beyond our control. Our maximum liability is limited to the value of the affected order.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">7. Governing law</h2>
          <p>These terms are governed by Nigerian law. Any disputes shall be resolved in Abia State courts.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">8. Changes</h2>
          <p>We may update these terms at any time. Continued use of the platform after changes constitutes acceptance.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">9. Contact</h2>
          <p>Questions? Email <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#F5A623] break-words">{SUPPORT_EMAIL}</a> or see our <a href="/contact" className="text-[#F5A623]">Contact</a> page.</p>
        </section>
      </div>
      </div>
      <SiteFooter />
    </main>
  )
}
