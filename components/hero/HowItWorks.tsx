'use client'

import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'
import { KineticHeading } from '@/components/fx'

const STEPS = [
  { step: '01', title: 'Browse',    desc: 'Open the app, see which campus restaurants are open right now, and pick what you want.' },
  { step: '02', title: 'Order',     desc: 'Add items to your cart, choose delivery to your hostel or pick up, and pay securely.' },
  { step: '03', title: 'Delivered', desc: 'A rider picks up your order and brings it straight to you. Track every step live.' },
]

/**
 * "How it works" as a pinned scroll story (the one pinned beat). On desktop the
 * section pins and the three steps light up one-by-one as a progress rail fills
 * with scroll. On phones it degrades to a plain stacked clip-reveal — no pin, no
 * scrub — so small screens stay snappy and predictable. Under reduced-motion it
 * renders fully static.
 *
 * Both responsive behaviours live here (via gsap.matchMedia) so a single hook
 * owns the steps' transforms — no competing ScrollTriggers writing the same
 * properties. Copy is unchanged from the previous static section.
 */
export function HowItWorks() {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (prefersReducedMotion()) return

      const mm = gsap.matchMedia()

      // ── Desktop: pinned step-through ──
      mm.add('(min-width: 768px)', () => {
        const steps = gsap.utils.toArray<HTMLElement>('.lx-hiw-step')
        const fill = root.current?.querySelector('.lx-hiw-rail-fill')
        if (steps.length !== 3) return

        gsap.set(steps, { opacity: 0.32, scale: 0.96, filter: 'saturate(0.6)' })
        gsap.set(steps[0], { opacity: 1, scale: 1, filter: 'saturate(1)' })
        if (fill) gsap.set(fill, { scaleX: 0, transformOrigin: 'left center' })

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: '.lx-hiw-stage',
            start: 'top top',
            end: '+=200%',
            scrub: 0.5,
            pin: true,
            anticipatePin: 1,
          },
        })

        if (fill) tl.to(fill, { scaleX: 1, duration: 3 }, 0)
        tl.to(steps[0], { opacity: 0.32, scale: 0.96, filter: 'saturate(0.6)', duration: 0.6 }, 1)
          .to(steps[1], { opacity: 1, scale: 1, filter: 'saturate(1)', duration: 0.6 }, 1)
          .to(steps[1], { opacity: 0.32, scale: 0.96, filter: 'saturate(0.6)', duration: 0.6 }, 2)
          .to(steps[2], { opacity: 1, scale: 1, filter: 'saturate(1)', duration: 0.6 }, 2)
      })

      // ── Mobile: simple clip-reveal stack ──
      mm.add('(max-width: 767px)', () => {
        const steps = gsap.utils.toArray<HTMLElement>('.lx-hiw-step')
        steps.forEach((s) => {
          gsap.fromTo(
            s,
            { clipPath: 'inset(100% 0 0 0)', y: 24, opacity: 0 },
            {
              clipPath: 'inset(0% 0 0 0)',
              y: 0,
              opacity: 1,
              duration: 0.8,
              ease: 'lx-smooth',
              scrollTrigger: { trigger: s, start: 'top 88%', once: true },
            },
          )
        })
      })

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div ref={root}>
      <div className="lx-hiw-stage max-w-5xl mx-auto">
        <KineticHeading
          as="h2"
          text="How it works"
          className="text-2xl sm:text-3xl font-bold text-center mb-10"
        />

        {/* Progress rail — only shown on the desktop pinned layout. */}
        <div className="lx-hiw-rail" aria-hidden="true">
          <span className="lx-hiw-rail-fill" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {STEPS.map(({ step, title, desc }) => (
            <div key={step} className="lx-hiw-step h-full">
              <div className="glass-thin p-6 space-y-3 h-full">
                <span className="lx-hiw-num lx-display lx-amber">{step}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
