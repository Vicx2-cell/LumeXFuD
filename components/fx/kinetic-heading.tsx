'use client'

import { useEffect, useRef } from 'react'
import SplitType from 'split-type'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

interface KineticHeadingProps {
  /** Heading copy (kept verbatim — split into words on the client). */
  text: string
  className?: string
  as?: 'h1' | 'h2' | 'h3'
  /** Stagger between words (s). */
  stagger?: number
}

/**
 * Section title that animates in by word — each word lifts out of an
 * overflow-hidden line with a bespoke ease (CustomEase 'lx-rise'), triggered
 * when the heading scrolls into view. The real text is in the DOM for SSR /
 * SEO / screen readers; SplitType only re-wraps it on the client.
 *
 * Renders fully visible by default and stays that way under reduced-motion or
 * if JS never runs (split happens client-side, animation arms after).
 */
export function KineticHeading({ text, className = '', as = 'h2', stagger = 0.06 }: KineticHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    const ctx = gsap.context(() => {
      const split = new SplitType(el, { types: 'lines,words', lineClass: 'lx-kine-line' })
      gsap.set(split.words, { yPercent: 115 })
      gsap.to(split.words, {
        yPercent: 0,
        duration: 0.85,
        ease: 'lx-rise',
        stagger,
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      })
      // Re-split on resize so line masks stay correct after reflow.
      const onResize = () => split.split({})
      window.addEventListener('resize', onResize)
      return () => {
        window.removeEventListener('resize', onResize)
        split.revert()
      }
    }, el)

    return () => ctx.revert()
  }, [text, stagger])

  const Tag = as
  return (
    <Tag ref={ref as never} className={`lx-kine ${className}`}>
      {text}
    </Tag>
  )
}
