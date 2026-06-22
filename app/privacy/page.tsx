import { SiteFooter } from '@/components/site-footer'

export const dynamic = 'force-dynamic'

export default function PrivacyPage() {
  return (
    <main style={{ background: '#0A0A0B' }}>
      <div className="min-h-dvh px-5 py-12 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-white/40 mb-8">Last updated: June 2026 · NDPR Compliant</p>

      <div className="space-y-8 text-sm leading-relaxed text-white/70">
        <section>
          <h2 className="text-base font-semibold text-white mb-2">1. Who we are</h2>
          <p>LumeX Fud is a campus food delivery platform operated by Lumex, serving students at Abia State University (ABSU), Nigeria. We are committed to protecting your personal data in accordance with the Nigeria Data Protection Regulation (NDPR) 2019.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">2. Data we collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Phone number (used for account identification and OTP authentication)</li>
            <li>Name and delivery address (hostel, room number)</li>
            <li>Order history and food preferences</li>
            <li>Payment information (processed securely by Paystack — we never store card details)</li>
            <li>Device information and IP address (for security and fraud prevention)</li>
            <li>Messages sent through the platform</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">3. How we use your data</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>To process and deliver your food orders</li>
            <li>To communicate order status via WhatsApp/SMS</li>
            <li>To improve our service quality and vendor performance</li>
            <li>To prevent fraud and ensure platform security</li>
            <li>To comply with legal obligations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">4. Your rights (NDPR)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Access:</strong> Request a copy of your data via Profile → Export my data</li>
            <li><strong className="text-white">Correction:</strong> Update your name, address in your Profile</li>
            <li><strong className="text-white">Deletion:</strong> Delete your account via Profile → Delete account</li>
            <li><strong className="text-white">Portability:</strong> Export your data in machine-readable format</li>
            <li><strong className="text-white">Objection:</strong> Opt out of leaderboard via Profile settings</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">5. Data retention</h2>
          <p>Order history is retained for 5 years for legal/tax purposes. Account data is deleted within 30 days of account deletion. Messages tied to disputed orders are retained until dispute resolution is complete.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">6. Third parties</h2>
          <p>We share data only with:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><strong className="text-white">Paystack</strong> — payment processing</li>
            <li><strong className="text-white">Sendchamp</strong> — SMS / OTP notifications</li>
            <li><strong className="text-white">Supabase</strong> — database hosting</li>
            <li><strong className="text-white">Vercel</strong> — application hosting</li>
          </ul>
          <p className="mt-2">All third parties are contractually bound to protect your data and may not use it for their own purposes.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-2">7. Contact us</h2>
          <p>For privacy-related requests or complaints, contact our Data Protection Officer at: <a href="mailto:hello@lumex.com.ng" className="text-[#F5A623]">hello@lumex.com.ng</a>. For anything else, see our <a href="/contact" className="text-[#F5A623]">Contact</a> page.</p>
        </section>
      </div>
      </div>
      <SiteFooter />
    </main>
  )
}
