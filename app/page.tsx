import Link from 'next/link'
import { Reveal } from '@/components/reveal'
import { MarketingFx, Magnetic, CountUp, SmoothScroll, KineticHeading, ClipReveal, Marquee, ParallaxImage } from '@/components/fx'
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
    <div className="lx-page lx-landing flex flex-col text-white overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* Marketing-only atmosphere: custom cursor + pointer-tracking glow.
          Inert on touch / reduced-motion (each primitive self-guards). */}
      <MarketingFx />
      {/* Lenis smooth scroll synced to the GSAP ticker — the backbone of the
          premium feel. Synced-touch ON so it glides on phones too. No-ops under
          reduced-motion. */}
      <SmoothScroll touch />

      {/* ── Nav (floats transparent over the hero, glass on scroll) ── */}
      <LandingNav />

      {/* ── Hero ── */}
      <Hero hoursLabel={hoursLabel} />

      {/* ── Stats strip ── */}
      {/* Borderless: the whole landing sits on one flat near-black canvas
          (.lx-landing), so the hero's floor-fade resolves into the page with no
          tonal step and no divider line — sections separate by whitespace only. */}
      <section className="relative z-10 pt-14 pb-10">
        <div className="max-w-4xl mx-auto px-5 mb-8 text-center">
          <Reveal><span className="lx-eyebrow">01 — Built for the campus</span></Reveal>
        </div>
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
        <div className="max-w-5xl mx-auto text-center mb-3">
          <Reveal><span className="lx-eyebrow">02 — From craving to doorstep</span></Reveal>
        </div>
        <HowItWorks />
      </section>

      {/* ── Kinetic marquee strip ── */}
      <div className="relative z-10 py-6">
        <Marquee
          items={['Hot food', 'Delivered fast', 'Campus-wide', 'Track live', 'Pay securely', 'No cash, no stress']}
          speed={30}
        />
      </div>

      {/* ── Featured food gallery (buyers) — premium masked-parallax imagery ── */}
      <section className="relative z-10 py-16 px-5">
        <div className="max-w-6xl mx-auto">
          <div className="mb-10">
            <Reveal><span className="lx-eyebrow">03 — On the menu</span></Reveal>
            <KineticHeading as="h2" text="Straight from the kitchen" className="lx-display-xl mt-3" />
            <Reveal delay={120}>
              <p className="text-white/55 mt-4 max-w-md">
                Real food from real campus kitchens — grilled, plated and on its way to you in minutes.
              </p>
            </Reveal>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
            {[
              { src: '/premium/dish-1.jpg', title: 'Grilled & spiced', sub: 'Smoky, fresh off the fire' },
              { src: '/premium/dish-2.jpg', title: 'Plated hot', sub: 'Chef-prepared, every order' },
              { src: '/premium/dish-3.jpg', title: 'Made to order', sub: 'Cooked when you tap' },
            ].map(({ src, title, sub }) => (
              <ParallaxImage
                key={src}
                src={src}
                alt={title}
                sizes="(max-width: 768px) 100vw, 33vw"
                className="aspect-[4/5]"
              >
                <span className="lx-gal-cap">
                  {title}
                  <small>{sub}</small>
                </span>
              </ParallaxImage>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why LumeX ── */}
      <section className="relative z-10 py-16 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-3">
            <Reveal><span className="lx-eyebrow">04 — Why LumeX</span></Reveal>
          </div>
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

      {/* ── The bigger picture (investors) ── */}
      <section className="relative z-10 py-20 px-5">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
          <div>
            <Reveal><span className="lx-eyebrow">05 — The bigger picture</span></Reveal>
            <KineticHeading as="h2" text="More than food." className="lx-display-xl mt-3" />
            <Reveal delay={100}>
              <p className="text-white/70 mt-5 text-lg leading-relaxed">
                LumeX Fud is the first product from <span className="lx-amber font-semibold">Lumex</span> — we&apos;re
                starting with the one thing every student needs daily, and building toward the everyday
                operating system for campus life in Southeast Nigeria.
              </p>
            </Reveal>
            <div className="mt-7 space-y-3">
              {[
                'Live at Abia State University, Uturu — built to scale campus by campus.',
                'A three-sided network: students order, vendors earn, riders deliver.',
                'Profitable on every order — digital-only, no cash, no subsidies.',
              ].map((t, i) => (
                <Reveal key={t} delay={160 + i * 90}>
                  <div className="flex gap-3 items-start">
                    <span className="lx-amber mt-1.5 shrink-0" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                    <p className="text-white/65 leading-relaxed">{t}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal delay={440}>
              <Magnetic className="inline-block mt-8">
                <Link href="/contact" className="lx-hero-ghost inline-flex items-center gap-2 px-7 py-3.5 text-sm font-medium" style={{ borderRadius: 14, minHeight: 52 }}>
                  Partner with us
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                </Link>
              </Magnetic>
            </Reveal>
          </div>
          <ParallaxImage src="/premium/delivery.jpg" alt="Night delivery rider" className="aspect-[4/5] md:aspect-[3/4]" sizes="(max-width: 768px) 100vw, 50vw" />
        </div>
      </section>

      {/* ── The founder ── */}
      <section className="relative z-10 py-16 px-5">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[0.8fr_1.2fr] gap-10 md:gap-14 items-center">
          <ClipReveal>
            {/* Monogram placeholder — drop in a real portrait at /premium/founder.jpg */}
            <figure className="lx-founder-portrait">
              <span className="lx-founder-mono" aria-hidden="true">CV</span>
              <figcaption>Founder portrait</figcaption>
            </figure>
          </ClipReveal>
          <div>
            <Reveal><span className="lx-eyebrow">06 — The founder</span></Reveal>
            <KineticHeading as="h2" text="Why I built LumeX" className="lx-display-xl mt-3" />
            <Reveal delay={100}>
              <p className="text-white/75 mt-5 text-xl leading-relaxed font-medium">
                &ldquo;Campus life in Southeast Nigeria deserves to run on rails that actually work. We&apos;re
                starting with hot food, delivered fast — and we&apos;re not stopping there.&rdquo;
              </p>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-6 font-semibold">Chibuike Victor</p>
              <p className="text-white/55 text-sm">Founder · Lumex</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 py-20 px-5">
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
