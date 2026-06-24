'use client'

import { useEffect, useRef } from 'react'

interface GlowFieldProps {
  /**
   * When true (default) the amber bloom eases toward the cursor (mouse) or the
   * dragging finger (touch). When false — or with reduced motion — it stays a
   * static ambient glow (the dashboard/auth tier).
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fine = window.matchMedia('(pointer: fine)').matches

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
    const kick = () => { if (!running) { running = true; raf = requestAnimationFrame(loop) } }
    const onPointer = (e: PointerEvent) => { tx = e.clientX; ty = e.clientY; kick() }
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      tx = t.clientX; ty = t.clientY; kick()
    }

    draw()
    // Mouse: follow the cursor. Touch: follow the finger as it drags — touchmove
    // keeps firing through a scroll, unlike pointer events (which get cancelled).
    if (fine) window.addEventListener('pointermove', onPointer, { passive: true })
    else window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('touchmove', onTouch)
      cancelAnimationFrame(raf)
    }
  }, [track])

  return (
    <div className="lx-glowfield" aria-hidden="true">
      <div ref={orbRef} className="lx-glowfield__orb" />
    </div>
  )
}
