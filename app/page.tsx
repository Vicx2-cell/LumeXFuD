import Link from 'next/link'
import {
  ArrowRight,
  Bike,
  Clock3,
  GraduationCap,
  MapPinned,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react'
import { Reveal } from '@/components/reveal'
import {
  ClipReveal,
  CountUp,
  ImageMarquee,
  KineticHeading,
  Magnetic,
  MarketingFx,
  Marquee,
  ParallaxImage,
  SmoothScroll,
} from '@/components/fx'
import { Hero } from '@/components/hero/Hero'
import { HowItWorks } from '@/components/hero/HowItWorks'
import { LandingNav } from '@/components/hero/LandingNav'
import { SiteFooter } from '@/components/site-footer'
import { getControls } from '@/lib/controls'
import { getFeature } from '@/lib/features'
import { formatHoursRange } from '@/lib/hours'

export const metadata = {
  title: { absolute: 'LumeX Fud - Premium food delivery and local discovery' },
  description:
    'Order from trusted local vendors, get fast delivery, and grow neighborhood businesses with a premium marketplace built to scale across campuses, cities, and states.',
  alternates: { canonical: '/' },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://lumexfud.com.ng/#org',
      name: 'LumeX Fud',
      url: 'https://lumexfud.com.ng',
      logo: 'https://lumexfud.com.ng/icons/icon-512-v2.png',
      description: 'Premium local food delivery marketplace starting at ABSU and built to scale across Nigerian cities and states.',
      areaServed: 'Nigeria',
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

const trustStats = [
  { value: 25, prefix: '< ', suffix: ' min', label: 'Fast delivery target' },
  { value: 100, prefix: '', suffix: '%', label: 'Local routing focus' },
  { value: 3, prefix: '', suffix: ' roles', label: 'Customers, vendors, riders' },
]

const audienceCards = [
  {
    icon: GraduationCap,
    title: 'For customers',
    copy: 'A cleaner way to order lunch, dinner, and late-night meals without guessing who is open in your area.',
    bullets: ['Fast local delivery', 'Live order updates', 'Trusted vendors nearby'],
    href: '/auth/register',
    cta: 'Start ordering',
  },
  {
    icon: Store,
    title: 'For vendors',
    copy: 'Turn local demand into repeat revenue with better store visibility, cleaner operations, and role-specific tooling.',
    bullets: ['Menu control', 'Operational dashboards', 'Premium growth tools'],
    href: '/apply/vendor',
    cta: 'Apply as vendor',
  },
  {
    icon: Bike,
    title: 'For riders',
    copy: 'Get a delivery workflow tuned for fast local movement, rider trust, and reliable handovers from pickup to doorstep.',
    bullets: ['Order assignment flow', 'Delivery proof and handover', 'Wallet and review history'],
    href: '/apply/rider',
    cta: 'Apply as rider',
  },
]

const differentiators = [
  {
    title: 'Focused local logistics',
    copy: 'Generic delivery apps feel broad and impersonal. LumeX is built around tighter local routing, clearer delivery context, and cleaner service zones.',
  },
  {
    title: 'Premium trust layer',
    copy: 'Cleaner vendor surfaces, verification cues, and role-aware dashboards make the product feel safer and more serious.',
  },
  {
    title: 'Sharper local identity',
    copy: 'Instead of a broad marketplace blur, the brand feels rooted in real local habits now and can keep that identity as it expands state by state.',
  },
  {
    title: 'Better three-sided UX',
    copy: 'Customers, vendors, and riders each get dedicated flows instead of being forced through one generic experience.',
  },
]

const comparisonRows = [
  {
    label: 'Built for focused local markets',
    lumex: 'Starts focused, scales deliberately',
    cityApps: 'Usually broad from day one',
  },
  {
    label: 'Area-aware delivery story',
    lumex: 'Clear and central',
    cityApps: 'Often just another address field',
  },
  {
    label: 'Vendor identity and trust',
    lumex: 'Stronger premium presentation',
    cityApps: 'Functional but less local',
  },
  {
    label: 'Rider workflow visibility',
    lumex: 'Local-delivery specific UX',
    cityApps: 'More generic operational flow',
  },
]

const proofPills = [
  'Fast ordering',
  'Trusted local vendors',
  'Role-specific tools',
  'Live tracking',
  'Secure payments',
  'Premium storefront feel',
]

export default async function LandingPage() {
  const controls = await getControls()
  const hoursLabel = formatHoursRange(controls.hours_open, controls.hours_close)
  const founderOn = await getFeature('founder')
  const partnerApplicationsOn = await getFeature('partner_applications')

  return (
    <div className="lx-page lx-landing flex flex-col overflow-hidden text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <MarketingFx />
      <SmoothScroll touch />

      <LandingNav />
      <Hero hoursLabel={hoursLabel} />

      <section className="relative z-10 px-5 pb-10 pt-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="glass-thick p-6 sm:p-7">
              <Reveal>
                <span className="lx-eyebrow">01 - Why this wins</span>
              </Reveal>
              <KineticHeading as="h2" text="Not another generic delivery clone." className="mt-3 text-3xl font-bold sm:text-4xl" />
              <Reveal delay={100}>
                <p className="mt-4 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
                  Chowdeck wins on breadth. Glovo wins on convenience categories. LumeX should win on focus:
                  a stronger local food and delivery experience that starts with ABSU now, then expands across
                  cities and states while still feeling more premium, more local, and more trustworthy than either.
                </p>
              </Reveal>
              <div className="mt-6 flex flex-wrap gap-2">
                {proofPills.map((pill, index) => (
                  <Reveal key={pill} delay={140 + index * 40}>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/75">
                      {pill}
                    </span>
                  </Reveal>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {trustStats.map((item, index) => (
                <ClipReveal key={item.label} delay={index * 0.08} className="h-full">
                  <div className="glass h-full p-5 text-center">
                    <p className="lx-display text-2xl font-bold text-[#F5A623] sm:text-3xl">
                      {item.prefix}
                      <CountUp value={item.value} />
                      {item.suffix}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-white/55 sm:text-sm">{item.label}</p>
                  </div>
                </ClipReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-5 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 text-center">
            <Reveal>
              <span className="lx-eyebrow">02 - Product edge</span>
            </Reveal>
          </div>
          <KineticHeading as="h2" text="Built for the local rush, not delivery sprawl" className="text-center text-2xl font-bold sm:text-4xl" />
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {differentiators.map((item, index) => (
              <ClipReveal key={item.title} delay={index * 0.08} className="h-full">
                <div className="glass-thin h-full p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F5A623]/12 text-[#F5A623]">
                    <Sparkles size={18} />
                  </div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-white/62">{item.copy}</p>
                </div>
              </ClipReveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 scroll-mt-20 px-5 py-16">
        <div className="mx-auto mb-3 max-w-5xl text-center">
          <Reveal>
            <span className="lx-eyebrow">03 - From craving to doorstep</span>
          </Reveal>
        </div>
        <HowItWorks />
      </section>

      <div className="relative z-10 py-6">
        <Marquee
          items={['Local-first', 'Premium storefronts', 'Fast handoff', 'Zone-aware delivery', 'Vendor trust', 'Rider workflow']}
          speed={28}
        />
      </div>

      <section className="relative z-10 px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10">
            <Reveal>
              <span className="lx-eyebrow">04 - Designed for every side</span>
            </Reveal>
            <KineticHeading as="h2" text="One marketplace, three strong journeys" className="mt-3 text-2xl font-bold sm:text-4xl" />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {audienceCards.map((card, index) => {
              const Icon = card.icon
              return (
                <ClipReveal key={card.title} delay={index * 0.08} className="h-full">
                  <div className="glass h-full p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F5A623]/12 text-[#F5A623]">
                      <Icon size={20} />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">{card.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-white/65">{card.copy}</p>
                    <div className="mt-5 space-y-2">
                      {card.bullets.map((bullet) => (
                        <div key={bullet} className="flex items-center gap-2 text-sm text-white/78">
                          <ShieldCheck size={16} className="text-[#F5A623]" />
                          <span>{bullet}</span>
                        </div>
                      ))}
                    </div>
                    <Magnetic className="mt-6 inline-block">
                      <Link
                        href={card.href}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium transition-colors hover:border-white/22 hover:bg-white/10"
                      >
                        {card.cta}
                        <ArrowRight size={16} />
                      </Link>
                    </Magnetic>
                  </div>
                </ClipReveal>
              )
            })}
          </div>
        </div>
      </section>

      <section className="relative z-10 px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10">
            <Reveal>
              <span className="lx-eyebrow">05 - Visual confidence</span>
            </Reveal>
            <KineticHeading as="h2" text="A marketplace that actually looks premium" className="mt-3 text-2xl font-bold sm:text-4xl" />
            <Reveal delay={100}>
              <p className="mt-4 max-w-xl text-white/62">
                Better than competitor pages does not just mean more sections. It means stronger photography, calmer
                hierarchy, and a brand that feels intentional before users even tap the first button.
              </p>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
            {[
              { src: '/premium/hero-food.jpg', title: 'Hot meals', sub: 'Food-first storytelling' },
              { src: '/premium/delivery.jpg', title: 'Fast handoff', sub: 'Rider confidence and speed' },
              { src: '/premium/dish-3.jpg', title: 'Real cravings', sub: 'Built around local demand' },
            ].map((item) => (
              <ParallaxImage
                key={item.src}
                src={item.src}
                alt={item.title}
                sizes="(max-width: 768px) 100vw, 33vw"
                className="aspect-[4/5]"
              >
                <span className="lx-gal-cap">
                  {item.title}
                  <small>{item.sub}</small>
                </span>
              </ParallaxImage>
            ))}
          </div>
        </div>
      </section>

      <div className="relative z-10 py-6">
        <ImageMarquee
          images={['/premium/dish-1.jpg', '/premium/dish-2.jpg', '/premium/hero-food.jpg', '/premium/delivery.jpg', '/premium/dish-3.jpg']}
          speed={42}
        />
      </div>

      <section className="relative z-10 px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <Reveal>
                <span className="lx-eyebrow">06 - Head-to-head</span>
              </Reveal>
              <KineticHeading as="h2" text="Why a focused local model can feel better" className="mt-3 text-2xl font-bold sm:text-4xl" />
              <Reveal delay={100}>
                <p className="mt-4 text-white/65">
                  Big marketplaces are impressive, but they are designed for scale across many locations. LumeX can
                  feel faster, clearer, and more trusted by narrowing the mission and over-delivering on one local
                  market at a time before expanding.
                </p>
              </Reveal>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]">
              <div className="grid grid-cols-[1.25fr_1fr_1fr] border-b border-white/10 bg-white/[0.03] px-5 py-4 text-xs uppercase tracking-[0.16em] text-white/45">
                <span>What matters</span>
                <span>LumeX</span>
                <span>Generic city apps</span>
              </div>
              {comparisonRows.map((row) => (
                <div key={row.label} className="grid grid-cols-[1.25fr_1fr_1fr] gap-3 border-b border-white/8 px-5 py-4 text-sm last:border-b-0">
                  <div className="font-medium text-white/92">{row.label}</div>
                  <div className="text-[#F5A623]">{row.lumex}</div>
                  <div className="text-white/55">{row.cityApps}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-5 py-16">
        <div className="mx-auto max-w-6xl grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="glass-thick p-7 sm:p-8">
            <Reveal>
              <span className="lx-eyebrow">07 - Proof of fit</span>
            </Reveal>
            <KineticHeading as="h2" text="Every detail should signal local control" className="mt-3 text-2xl font-bold sm:text-4xl" />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                {
                  icon: Clock3,
                  title: `Open daily ${hoursLabel}`,
                  copy: 'Availability is visible immediately, so customers know when to order and vendors know when demand peaks.',
                },
                {
                  icon: MapPinned,
                  title: 'Zone and city awareness',
                  copy: 'Delivery feels local, not generic, because service zones and movement patterns are part of the product story.',
                },
                {
                  icon: Users,
                  title: 'Built for repeat behavior',
                  copy: 'The strongest local commerce products reward habits, not just one-off orders.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Safer and more trusted',
                  copy: 'Trust cues, verification, and cleaner role-specific UX raise conversion quality.',
                },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F5A623]/12 text-[#F5A623]">
                      <Icon size={18} />
                    </div>
                    <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-white/62">{item.copy}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <ParallaxImage
            src="/premium/delivery.jpg"
            alt="Night delivery rider"
            className="aspect-[16/11] md:aspect-[3/4]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </div>
      </section>

      {founderOn && (
        <section className="relative z-10 px-5 py-16">
          <div className="mx-auto max-w-6xl grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:items-center md:gap-14">
            <ClipReveal>
              <figure className="lx-founder-portrait">
                <span className="lx-founder-mono" aria-hidden="true">CV</span>
                <figcaption>Founder portrait</figcaption>
              </figure>
            </ClipReveal>
            <div>
              <Reveal>
                <span className="lx-eyebrow">08 - The founder</span>
              </Reveal>
              <KineticHeading as="h2" text="Built because local commerce deserves better" className="mt-3 text-2xl font-bold sm:text-4xl" />
              <Reveal delay={100}>
                <p className="mt-5 text-xl font-medium leading-relaxed text-white/75">
                  &ldquo;The goal is simple: make local ordering feel cleaner, faster, and more premium than anything
                  generic delivery apps bring to growing markets.&rdquo;
                </p>
              </Reveal>
              <Reveal delay={200}>
                <p className="mt-6 font-semibold">Chibuike Victor</p>
                <p className="text-sm text-white/55">Founder - Lumex</p>
              </Reveal>
            </div>
          </div>
        </section>
      )}

      <section className="relative z-10 px-5 py-20">
        <Reveal>
          <div className="glass-thick mx-auto max-w-3xl space-y-5 p-8 text-center">
            <span className="lx-eyebrow">09 - Launch your side</span>
            <KineticHeading as="h2" text="Make local ordering feel first-class" className="text-3xl font-bold" />
            <p className="mx-auto max-w-xl text-white/62">
              Customers get speed. Vendors get growth. Riders get a better work loop. That is how LumeX becomes better
              than the obvious alternatives: not by copying them, but by being more focused than they can afford to be.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Magnetic>
                <Link
                  href="/auth/register"
                  className="lx-btn-amber inline-flex min-h-[56px] items-center justify-center px-10 py-4 text-base"
                >
                  Create account
                </Link>
              </Magnetic>
              <Magnetic>
                <Link
                  href="/contact"
                  className="inline-flex min-h-[56px] items-center justify-center rounded-2xl border border-white/12 bg-white/6 px-8 py-4 text-base font-medium transition-colors hover:border-white/22 hover:bg-white/10"
                >
                  Talk to us
                </Link>
              </Magnetic>
            </div>
            {partnerApplicationsOn && (
              <div className="grid gap-3 pt-2 text-left sm:grid-cols-2">
                <Link
                  href="/apply/vendor"
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 transition-colors hover:border-white/20"
                >
                  <p className="text-sm font-semibold text-white">Apply as a vendor</p>
                  <p className="mt-1 text-sm text-white/50">Get your store in front of local demand with a cleaner brand presence.</p>
                </Link>
                <Link
                  href="/apply/rider"
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 transition-colors hover:border-white/20"
                >
                  <p className="text-sm font-semibold text-white">Apply as a rider</p>
                  <p className="mt-1 text-sm text-white/50">Join the delivery side of the product with a workflow tuned for fast local runs.</p>
                </Link>
              </div>
            )}
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  )
}
