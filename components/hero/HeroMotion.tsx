'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

/**
 * The moving image layer of the hero — the one bold moment.
 *
 * - Ken Burns zoom (scale 1.07 → 1 over 24s) is pure CSS on the <img> itself.
 * - Scroll parallax drifts the whole image wrapper upward via a GSAP
 *   ScrollTrigger scrub, synced to Lenis (see SmoothScroll) for a buttery,
 *   single-engine feel — transform only. The wrapper carries vertical slack
 *   (top:-8%/height:116%) so the drift never reveals the fallback edge.
 *
 * Two art-directed crops: a wide desktop frame and a tall phone frame, switched
 * by CSS breakpoint. Both `priority` so whichever is shown is the preloaded LCP.
 * Swap the look by replacing /public/hero.jpg + /public/hero-mobile.jpg — no code
 * change needed.
 */

// Tiny (~12px) blur so the photo fades up from a colour smear instead of popping.
const BLUR =
  'data:image/jpeg;base64,/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAVAAwDASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAQGAQX/xAAlEAACAAYBAgcAAAAAAAAAAAABAgADBBESIQUxURMUIkFhccH/xAAUAQEAAAAAAAAAAAAAAAAAAAAD/8QAFxEBAQEBAAAAAAAAAAAAAAAAAQACQf/aAAwDAQACEQMRAD8A0SPM8bkclaWSxQbvfoYkaiidJpF9+4ilm8lUyWeSpZmQ+rxAMD2tvpCh5+SpImUstm77/IA1o5K4HslycxlpNWKOdKRfH6McpcmF8iPgQQQpGt//2Q=='

export function HeroMotion() {
  const wrapRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = wrapRef.current
      // Scroll-driven, so it works on touch as well as a mouse — only motion
      // preference gates it out.
      if (!el || prefersReducedMotion()) return

      // Drift the image wrapper upward as the hero scrolls past. Scrub ties it
      // to scroll position (Lenis updates ScrollTrigger), capped by the slack.
      gsap.to(el, {
        yPercent: -8,
        ease: 'none',
        scrollTrigger: {
          trigger: el.closest('.lx-hero') ?? el,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.4,
        },
      })
    },
    { scope: wrapRef },
  )

  return (
    <div ref={wrapRef} className="lx-hero-parallax">
      {/* Wide desktop crop */}
      <Image
        src="/hero.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        quality={85}
        placeholder="blur"
        blurDataURL={BLUR}
        className="lx-hero-img lx-hero-img--wide"
      />
      {/* Tall phone crop */}
      <Image
        src="/hero-mobile.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        quality={85}
        placeholder="blur"
        blurDataURL={BLUR}
        className="lx-hero-img lx-hero-img--tall"
      />
    </div>
  )
}
