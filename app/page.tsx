import Link from 'next/link'
import { Reveal } from '@/components/reveal'
import { MarketingFx, Magnetic, CountUp, SmoothScroll, KineticHeading, ClipReveal, Marquee } from '@/components/fx'
import { Hero } from '@/components/hero/Hero'
import { HowItWorks } from '@/components/hero/HowItWorks'
import { LandingNav } from '@/components/hero/LandingNav'
import { getControls } from '@/lib/controls'
import { formatHoursRange } from '@/lib/hours'
import { SiteFooter } from '@/components/site-footer'

export const metadata = {
  title: { absolute: 'LumeX Fud — Campus food delivery at ABSU, Uturu' },
  description: 'Order food from your favourite ABSU campus restaurants. Fast delivery to your hostel, live tracking, and secure digital payment.',
  alternates: { canonical: '/' },
}

// Structured data so Google understands the brand "LumeX Fud" (helps the site
// surface for brand searches and can enable a richer listing).
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://lumexfud.com.ng/#org',
      name: 'LumeX Fud',
      url: 'https://lumexfud.com.ng',
      logo: 'https://lumexfud.com.ng/icons/icon-512-v2.png',
      description: 'Campus food delivery for Abia State University (ABSU), Uturu, Nigeria.',
      areaServed: 'Abia State University (ABSU), Uturu, Nigeria',
    },
    {
      '@type': 'WebSite',
      '@id': 'https://lumexfud.com.ng/#website',
      name: 'LumeX Fud',
      url: 'https://lumexfud.com.ng',
      publisher: { '@id': 'https://lumexfud.com.ng/#org' },
    },
  ],
}

/* Inline Lucide-style icons (SVG, not emoji) — consistent 1.75 stroke, amber. */
const iconProps = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
  stroke: '#F5A623', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}
const BoltIcon   = () => <svg {...iconProps} aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg>
const TrophyIcon = () => <svg {...iconProps} aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
const PinIcon    = () => <svg {...iconProps} aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
const LockIcon   = () => <svg {...iconProps} aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>

export default async function LandingPage() {
  // Live opening hours from super-admin controls (so editing them updates the
  // site, instead of the old hardcoded "7am – 10pm").
  const controls = await getControls()
  const hoursLabel = formatHoursRange(controls.hours_open, controls.hours_close)
  return (
    <div className="lx-page flex flex-col text-white overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* Marketing-only atmosphere: custom cursor + pointer-tracking glow.
          Inert on touch / reduced-motion (each primitive self-guards). */}
      <MarketingFx />
      {/* Lenis smooth scroll synced to the GSAP ticker — the backbone of the
          premium feel. Synced-touch ON so it glides on phones too. No-ops under
          reduced-motion. */}
      <SmoothScroll touch />
      <div className="lx-orb lx-orb--amber" aria-hidden="true" />
      <div className="lx-orb lx-orb--indigo" aria-hidden="true" />

      {/* ── Nav (floats transparent over the hero, glass on scroll) ── */}
      <LandingNav />

      {/* ── Hero ── */}
      <Hero hoursLabel={hoursLabel} />

      {/* ── Stats strip ── */}
      {/* No top border: the hero's floor-fade scrim already resolves to the page
          background (#0A0A0B), so the hero dissolves seamlessly into this strip.
          A divider here would re-introduce the hard "cut line". */}
      <section className="relative z-10 border-b border-white/8 py-8">
        <div className="max-w-4xl mx-auto px-5 grid grid-cols-3 gap-6 text-center">
          {[
            { num: 25,  prefix: '< ', suffix: ' min', label: 'Average delivery' },
            { num: 100, prefix: '',   suffix: '%',     label: 'Campus coverage' },
            { num: 7,   prefix: '',   suffix: ' days', label: 'Every week' },
          ].map(({ num, prefix, suffix, label }, i) => (
            <Reveal key={label} delay={i * 90}>
              <p className="lx-display lx-amber text-2xl sm:text-3xl font-bold tabular-nums">
                {prefix}<CountUp value={num} />{suffix}
              </p>
              <p className="text-xs sm:text-sm text-white/55 mt-1">{label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── How it works (pinned scroll story on desktop) ── */}
      <section id="how-it-works" className="relative z-10 py-16 px-5 scroll-mt-20">
        <HowItWorks />
      </section>

      {/* ── Kinetic marquee strip ── */}
      <div className="relative z-10 py-5 border-y border-white/8 bg-white/[0.015]">
        <Marquee
          items={['Hot food', 'Delivered fast', 'Campus-wide', 'Track live', 'Pay securely', 'No cash, no stress']}
          speed={30}
        />
      </div>

      {/* ── Why LumeX ── */}
      <section className="relative z-10 py-16 px-5 border-t border-white/8">
        <div className="max-w-4xl mx-auto">
          <KineticHeading
            as="h2"
            text="Built for campus life"
            className="text-2xl sm:text-3xl font-bold text-center mb-10"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              { Icon: BoltIcon,   title: 'Fast delivery',     desc: 'Our riders know every corner of ABSU campus. Average delivery under 25 minutes.' },
              { Icon: TrophyIcon, title: 'Weekly leaderboard', desc: 'Every completed order climbs you up the weekly leaderboard. Be the campus #1.' },
              { Icon: PinIcon,    title: 'Live tracking',      desc: 'See your order status in real time — from the kitchen to your doorstep.' },
              { Icon: LockIcon,   title: 'Safe payments',      desc: 'Pay with your card or bank transfer via Paystack. No cash, no stress.' },
            ].map(({ Icon, title, desc }, i) => (
              <ClipReveal key={title} delay={i * 0.08} className="h-full">
                <div className="glass p-6 flex gap-4 items-start transition-transform hover:-translate-y-1 h-full">
                  <span className="lx-icon-badge flex-shrink-0 w-11 h-11 rounded-xl">
                    <Icon />
                  </span>
                  <div>
                    <h3 className="font-semibold mb-1">{title}</h3>
                    <p className="text-sm text-white/60 leading-relaxed">{desc}</p>
                  </div>
                </div>
              </ClipReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 py-20 px-5 border-t border-white/8">
        <Reveal>
          <div className="max-w-xl mx-auto glass-thick p-8 text-center space-y-5">
            <KineticHeading as="h2" text="Ready to eat?" className="text-3xl font-bold" />
            <p className="text-white/60">
              Create your free account in under a minute and start ordering from campus restaurants now.
            </p>
            <Magnetic>
              <Link
                href="/auth/register"
                className="lx-btn-amber inline-flex items-center justify-center px-10 py-4 text-base"
                style={{ minHeight: 56 }}
              >
                Get started — it&apos;s free
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <SiteFooter />

    </div>
  )
}
