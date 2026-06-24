'use client'

import { useEffect, useRef, useState, Fragment } from 'react'

export interface HeadingSegment {
  text: string
  /** Extra classes for this run of words (e.g. an amber accent). */
  className?: string
  /** Insert a line break BEFORE this segment. */
  breakBefore?: boolean
}

interface AnimatedHeadingProps {
  /** Either a plain string, or styled segments for multi-colour / multi-line. */
  text?: string
  segments?: HeadingSegment[]
  className?: string
  as?: 'h1' | 'h2' | 'h3'
  /** Base delay before the first word (ms). */
  delay?: number
}

/**
 * Word-stagger entrance: each word rises out of an overflow-hidden mask. The
 * heading renders fully visible by default (SSR / no-JS / reduced-motion safe)
 * and only "arms" the masked state on the client, then plays once on scroll-in.
 * Marketing only. aria-label carries the full text for screen readers.
 */
export function AnimatedHeading({ text, segments, className = '', as = 'h1', delay = 0 }: AnimatedHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null)
  const [armed, setArmed] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(true); return }
    setArmed(true)
    const el = ref.current
    if (!el) { setShown(true); return }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setShown(true); io.disconnect(); break }
        }
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const segs: HeadingSegment[] = segments ?? [{ text: text ?? '' }]
  const label = segs.map((s) => s.text).join(' ')

  const Tag = as
  let wordIndex = 0
  return (
    <Tag
      ref={ref as never}
      aria-label={label}
      className={`lx-ah ${armed ? 'lx-ah--armed' : ''} ${shown ? 'lx-ah--in' : ''} ${className}`}
    >
      {segs.map((seg, si) => {
        const words = seg.text.split(' ').filter(Boolean)
        return (
          <Fragment key={si}>
            {seg.breakBefore && <br />}
            {words.map((w, wi) => {
              const d = delay + wordIndex * 55
              wordIndex += 1
              return (
                <Fragment key={`${si}-${wi}`}>
                  <span className="lx-ah-mask" aria-hidden="true">
                    <span className={`lx-ah-word ${seg.className ?? ''}`} style={{ transitionDelay: `${d}ms` }}>
                      {w}
                    </span>
                  </span>
                  {wi < words.length - 1 ? ' ' : ''}
                </Fragment>
              )
            })}
            {/* keep a space between segments on the same line */}
            {!segs[si + 1]?.breakBefore && si < segs.length - 1 ? ' ' : ''}
          </Fragment>
        )
      })}
    </Tag>
  )
}
