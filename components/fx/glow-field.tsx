'use client'

import { useEffect, useRef } from 'react'

interface GlowFieldProps {
  /**
   * When true (default) the amber bloom eases toward the pointer on a fine
   * pointer. When false — or on touch / reduced motion — it stays a static
   * ambient glow (the dashboard/auth tier).
   */
  track?: boolean
}

/**
 * Fixed, behind-content ambient amber glow. The pointer-tracking variant is for
 * marketing + auth; dashboards pass `track={false}` for a calm static wash.
 *
 * Perf: the glow is a single blurred orb moved with `transform` (GPU-composited,
 * no repaint) — never an animated full-viewport gradient. The rAF loop only runs
 * while the orb is catching up to the pointer and stops the instant it settles,
 * so an idle page costs ~0 CPU.
 */
export function GlowField({ track = true }: GlowFieldProps) {
  const orbRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const orb = orbRef.current
    if (!orb || !track) return
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return

    let tx = window.innerWidth * 0.5
    let ty = window.innerHeight * 0.28
    let cx = tx
    let cy = ty
    let raf = 0
    let running = false

    const draw = () => { orb.style.transform = `translate3d(${cx}px, ${cy}px, 0)` }
    const loop = () => {
      cx += (tx - cx) * 0.08
      cy += (ty - cy) * 0.08
      draw()
      // Stop once we've effectively reached the target — restart on next move.
      if (Math.abs(tx - cx) < 0.5 && Math.abs(ty - cy) < 0.5) { running = false; return }
      raf = requestAnimationFrame(loop)
    }
    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      if (!running) { running = true; raf = requestAnimationFrame(loop) }
    }

    draw()
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [track])

  return (
    <div className="lx-glowfield" aria-hidden="true">
      <div ref={orbRef} className="lx-glowfield__orb" />
    </div>
  )
}
