'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

interface ClipRevealProps {
  children: ReactNode
  className?: string
  /** Reveal start delay (s). */
  delay?: number
  as?: 'div' | 'li' | 'section'
}

/**
 * Reveals its contents with a clip-path wipe (inset(100% 0 0 0) → 0) plus a
 * small rise, the first time it scrolls into view. Premium, GPU-cheap (clip +
 * transform only). SSR-safe: renders fully visible; the wipe only arms on the
 * client after motion is confirmed allowed, so no-JS / reduced-motion shows the
 * content immediately.
 */
export function ClipReveal({ children, className = '', delay = 0, as = 'div' }: ClipRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { clipPath: 'inset(100% 0 0 0)', y: 26, opacity: 0 },
        {
          clipPath: 'inset(0% 0 0 0)',
          y: 0,
          opacity: 1,
          duration: 0.95,
          delay,
          ease: 'lx-smooth',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        },
      )
    }, el)

    return () => ctx.revert()
  }, [delay])

  const Tag = as
  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  )
}
