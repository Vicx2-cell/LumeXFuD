export default function TermsPage() {
  return (
    <main className="min-h-dvh px-5 py-12 max-w-2xl mx-auto" style={{ background: '#0A0A0B' }}>
      <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-white/40 mb-8">Last updated: January 2026</p>

      <div className="space-y-8 text-sm leading-relaxed text-white/70">
        <section>
          <h2 className="text-base font-semibold text-white mb-2">1. Acceptance of terms</h2>
          <p>By using LumeX Fud, you agree to these terms. These terms govern your use of our campus food delivery service at Abia State University (ABSU).</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">2. Platform hours & service</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>LumeX Fud operates 7am – 10pm daily</li>
            <li>Minimum order is ₦500</li>
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
          <h2 className="text-base font-semibold text-white mb-2">4. Disputes</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>You may raise a dispute within 15 minutes of receiving your order</li>
            <li>Disputes are reviewed by our admin team within 24 hours</li>
            <li>Refunds are at admin discretion based on evidence provided</li>
            <li>Abusing the dispute system may result in account suspension</li>
          </ul>
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
          <p>Questions? Email <span className="text-[#F5A623]">support@lumexfud.com.ng</span></p>
        </section>
      </div>
    </main>
  )
}
