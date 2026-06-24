'use client'

import Image from 'next/image'
import { useEffect, useRef } from 'react'

/**
 * The moving image layer of the hero — the one bold moment.
 *
 * - Ken Burns zoom (scale 1.07 → 1 over 24s) is pure CSS on the <img> itself.
 * - Scroll parallax drifts the whole image wrapper upward at ~0.3× scroll speed
 *   (transform: translateY only, one throttled rAF-driven scroll listener). It's
 *   scroll-driven, so it runs on touch too (motion-allowed only) — the wrapper
 *   carries vertical slack (top:-8%/height:116%) so the drift never reveals the
 *   fallback edge.
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

  useEffect(() => {
    // Scroll-driven, so it works on touch as well as a mouse — only motion
    // preference gates it out.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const el = wrapRef.current
    if (!el) return

    let raf = 0
    let queued = false
    const apply = () => {
      queued = false
      // Drift up at 0.3× scroll, capped so the slack never runs out.
      const y = Math.min(window.scrollY * 0.3, 90)
      el.style.transform = `translate3d(0, ${-y}px, 0)`
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      raf = requestAnimationFrame(apply)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    apply()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

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
