'use client'

import { useRef, type ReactNode } from 'react'

interface MagneticProps {
  children: ReactNode
  /** How strongly the element pulls toward the cursor (0–1). */
  strength?: number
  className?: string
}

/**
 * Wraps an interactive element so it leans toward the cursor on a fine pointer.
 * No-op on touch and with reduced motion. Decorative only — wraps the existing
 * child (e.g. a Link/button) without altering its behaviour. Marketing only.
 */
export function Magnetic({ children, strength = 0.35, className = '' }: MagneticProps) {
  const ref = useRef<HTMLSpanElement>(null)

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2)
    const y = e.clientY - (r.top + r.height / 2)
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`
  }
  const reset = () => {
    if (ref.current) ref.current.style.transform = ''
  }

  return (
    <span
      ref={ref}
      className={`lx-magnetic ${className}`}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{ transition: 'transform 0.25s var(--spring-snappy)', willChange: 'transform' }}
      data-cursor
    >
      {children}
    </span>
  )
}
