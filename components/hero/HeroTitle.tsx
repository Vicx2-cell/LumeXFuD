'use client'

import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import SplitType from 'split-type'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

/**
 * The hero headline — the one bold moment. The full wordmark sentence is real
 * text in the DOM (SSR / SEO / screen readers via aria-label); on the client,
 * if motion is allowed, it's split into characters that un-blur, lift and scale
 * into focus on load — the signature "premium" reveal in the first second.
 *
 * Copy is unchanged from the previous AnimatedHeading: "Hot food," then the
 * amber "delivered hot." on a new line. useGSAP runs at layout timing (no flash)
 * and auto-reverts on unmount. Under reduced-motion / no-JS it simply renders as
 * a static, fully-legible heading.
 */
export function HeroTitle() {
  const ref = useRef<HTMLHeadingElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el || prefersReducedMotion()) return

      const split = new SplitType(el, { types: 'chars' })
      const chars = split.chars ?? []

      gsap.set(el, { transformOrigin: 'left top', scale: 1.07 })
      gsap.set(chars, { opacity: 0, yPercent: 28, filter: 'blur(12px)' })

      gsap
        .timeline({ delay: 0.26 })
        .to(el, { scale: 1, duration: 1.15, ease: 'lx-smooth' }, 0)
        .to(
          chars,
          {
            opacity: 1,
            yPercent: 0,
            filter: 'blur(0px)',
            duration: 0.8,
            ease: 'lx-rise',
            stagger: 0.022,
          },
          0,
        )

      return () => split.revert()
    },
    { scope: ref },
  )

  return (
    <h1
      ref={ref}
      aria-label="Hot food, delivered hot."
      className="lx-hero-title lx-hero-title--kinetic"
    >
      Hot food,
      <br />
      <span className="lx-amber">delivered hot.</span>
    </h1>
  )
}
