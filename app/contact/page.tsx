import { getControls } from '@/lib/controls'
import { formatHoursRange } from '@/lib/hours'
import { SiteFooter, SUPPORT_EMAIL, BRAND, OPERATOR } from '@/components/site-footer'

export const dynamic = 'force-dynamic'

// Public contact page: who we are + how to reach us. Card/payment reviewers expect
// a visible business identity and at least one direct support channel.
export default async function ContactPage() {
  const controls = await getControls()
  const hoursLabel = formatHoursRange(controls.hours_open, controls.hours_close)
  const phone = (controls.support_phone ?? '').trim()
  const waDigits = phone.replace(/[^\d]/g, '')

  return (
    <main style={{ background: '#0A0A0B' }}>
      <div className="min-h-dvh px-5 py-12 max-w-2xl mx-auto" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 3rem)' }}>
        <h1 className="text-2xl font-bold mb-2 text-white">Contact &amp; support</h1>
        <p className="text-sm text-white/40 mb-8">We’re here to help with orders, payments and refunds.</p>

        <div className="space-y-8 text-base leading-relaxed text-white/70 [overflow-wrap:anywhere]">
          <section>
            <h2 className="text-base font-semibold text-white mb-2">Who we are</h2>
            <p>{BRAND} is a campus food delivery service for students at Abia State University (ABSU), Nigeria, operated by {OPERATOR}. You order from campus vendors, pay securely with Paystack, and a rider brings it to you — or you skip the queue and collect it yourself.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Reach us</h2>
            <ul className="space-y-2">
              <li>
                <span className="text-white/45">Support email: </span>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#F5A623] break-words">{SUPPORT_EMAIL}</a>
              </li>
              {phone ? (
                <>
                  <li>
                    <span className="text-white/45">Phone: </span>
                    <a href={`tel:+${waDigits}`} className="text-[#F5A623]">{phone}</a>
                  </li>
                  <li>
                    <span className="text-white/45">WhatsApp: </span>
                    <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer" style={{ color: '#25D366' }}>Chat with us on WhatsApp</a>
                  </li>
                </>
              ) : (
                <li className="text-white/45">Phone/WhatsApp support line coming soon — email us and we’ll respond fast.</li>
              )}
              <li><span className="text-white/45">Hours: </span><span className="text-white">{hoursLabel} daily</span></li>
              <li><span className="text-white/45">Location: </span><span className="text-white">Abia State University (ABSU) campus, Uturu, Abia State, Nigeria</span></li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Refunds &amp; order problems</h2>
            <p>For anything about a charge, a cancellation or a refund, please read our <a href="/refunds" className="text-[#F5A623]">Refund &amp; Cancellation Policy</a> first — it explains exactly when refunds apply. Then email us your order number if you still need help.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">More</h2>
            <p>See our <a href="/terms" className="text-[#F5A623]">Terms of Service</a> and <a href="/privacy" className="text-[#F5A623]">Privacy Policy</a>.</p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  )
}
