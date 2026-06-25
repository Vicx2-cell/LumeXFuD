'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap, ScrollTrigger, prefersReducedMotion } from '@/lib/gsap'

interface SmoothScrollProps {
  /**
   * Sync touch scrolling through Lenis too (the premium "glide" on touch).
   * ON for the marketing landing — the whole page should feel cinematic on a
   * mid-range Android. OFF for transactional surfaces (customer home), where
   * native touch scroll keeps fast flicks to a vendor instant and lets nested
   * scrollers / the on-screen keyboard behave normally.
   */
  touch?: boolean
}

/**
 * Mounts Lenis smooth scroll and drives it from GSAP's ticker (the canonical
 * Lenis + GSAP integration: one rAF loop, lagSmoothing off). Renders nothing —
 * it operates on the document, so it drops into a server-rendered page next to
 * the other mount-only FX (like <MarketingFx />) without making the page a
 * client component.
 *
 * Hard no-ops under prefers-reduced-motion: native scrolling stays, and
 * ScrollTrigger-based reveals each fall back to "shown" on their own.
 *
 * Nested scroll areas (modals, chat panels, the Lumi sheet) opt out with
 * `data-lenis-prevent` on their scroll container.
 */
export function SmoothScroll({ touch = false }: SmoothScrollProps) {
  useEffect(() => {
    if (prefersReducedMotion()) return

    const lenis = new Lenis({
      duration: 1.05,
      // Gentle, natural deceleration — not a long floaty drift.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: touch,
      // Lighten the synced-touch feel so it never lags a fast swipe.
      syncTouchLerp: 0.075,
      touchMultiplier: touch ? 1.4 : 1,
    })

    // Single rAF: GSAP's ticker pumps Lenis (gives ms → Lenis wants ms).
    const raf = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)

    // Keep ScrollTrigger in lockstep with Lenis' virtual scroll position.
    lenis.on('scroll', ScrollTrigger.update)

    return () => {
      lenis.off('scroll', ScrollTrigger.update)
      gsap.ticker.remove(raf)
      lenis.destroy()
    }
  }, [touch])

  return null
}
