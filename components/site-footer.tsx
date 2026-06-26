import Link from 'next/link'
import { getControls } from '@/lib/controls'
import { formatHoursRange } from '@/lib/hours'

// Single business email shown across the site (also in /terms + /privacy). Keep
// this in sync with the email on the Paystack business profile.
export const SUPPORT_EMAIL = 'hello@lumex.com.ng'
// Trading name (must match the Paystack profile) and the operating entity.
export const BRAND = 'LumeX Fud'
export const OPERATOR = 'Lumex'

// Global footer for public + policy pages: consistent business identity, visible
// contact details, and links to every legal/policy surface a payment processor
// expects to find. Server component — reads live hours + the super-admin support
// phone from controls.
export async function SiteFooter() {
  const controls = await getControls()
  const hoursLabel = formatHoursRange(controls.hours_open, controls.hours_close)
  const phone = (controls.support_phone ?? '').trim()
  const waDigits = phone.replace(/[^\d]/g, '')

  return (
    <footer className="lx-footer relative z-10 border-t border-white/8 py-8 px-5" style={{ background: '#0A0A0B' }}>
      <div className="max-w-4xl mx-auto flex flex-col gap-5 text-xs text-white/40">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1.5">
            <p>
              <span className="lx-display font-semibold lx-amber text-sm">{BRAND}</span>
              <span className="text-white/35"> — Campus life, simplified.</span>
            </p>
            <p>Campus food delivery for students at Abia State University (ABSU), Nigeria.</p>
            <p>Operated by {OPERATOR}. Digital payments only — secured by Paystack.</p>
          </div>

          <div className="space-y-1.5 sm:text-right">
            <p className="text-white/55 font-medium">Contact &amp; support</p>
            <p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-white/80 transition-colors break-words">{SUPPORT_EMAIL}</a>
            </p>
            {phone && (
              <p className="flex sm:justify-end items-center gap-3">
                <a href={`tel:+${waDigits}`} className="hover:text-white/80 transition-colors">{phone}</a>
                <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer" className="hover:text-white/80 transition-colors" style={{ color: '#25D366' }}>WhatsApp</a>
              </p>
            )}
            <p>Open {hoursLabel} daily</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/8 pt-3 -mb-1">
          <Link href="/" className="inline-flex items-center min-h-[44px] py-1.5 hover:text-white/70 transition-colors">Home</Link>
          <Link href="/contact" className="inline-flex items-center min-h-[44px] py-1.5 hover:text-white/70 transition-colors">Contact</Link>
          <Link href="/refunds" className="inline-flex items-center min-h-[44px] py-1.5 hover:text-white/70 transition-colors">Refunds &amp; Cancellations</Link>
          <Link href="/terms" className="inline-flex items-center min-h-[44px] py-1.5 hover:text-white/70 transition-colors">Terms</Link>
          <Link href="/privacy" className="inline-flex items-center min-h-[44px] py-1.5 hover:text-white/70 transition-colors">Privacy</Link>
          <span className="w-full sm:w-auto sm:ml-auto text-white/25">© {new Date().getFullYear()} {OPERATOR}</span>
        </div>
      </div>
    </footer>
  )
}
