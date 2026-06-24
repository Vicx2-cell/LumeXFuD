'use client'

import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  /** Target value to count up to. */
  value: number
  /** Animation length in ms. */
  duration?: number
  /** Decimal places to render. */
  decimals?: number
  /** Custom number formatter (e.g. toLocaleString). Overrides `decimals`. */
  format?: (n: number) => string
  className?: string
}

/**
 * Eased count-up for a KPI number. Animates 0 → value the FIRST time it scrolls
 * into view; after that, value changes (e.g. a dashboard poll) snap instantly so
 * live data never "re-animates" on every refetch. Honours prefers-reduced-motion
 * (shows the final value immediately) and is SSR-safe (renders the final value
 * until the client takes over).
 */
export function CountUp({ value, duration = 1100, decimals = 0, format, className = '' }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)
  const animatedOnce = useRef(false)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // After the first reveal, or with reduced motion, just track the value.
    if (reduce || animatedOnce.current) { setDisplay(value); return }

    const el = ref.current
    if (!el) { setDisplay(value); return }

    let raf = 0
    const animate = () => {
      animatedOnce.current = true
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
        setDisplay(value * eased)
        if (t < 1) raf = requestAnimationFrame(tick)
        else setDisplay(value)
      }
      raf = requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { animate(); io.disconnect(); break }
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [value, duration])

  const text = format ? format(display) : display.toFixed(decimals)
  return <span ref={ref} className={`tabular-nums ${className}`}>{text}</span>
}
