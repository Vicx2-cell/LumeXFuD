'use client'

import { useEffect, useRef } from 'react'

/**
 * Custom pointer: a lerp-follow glowing amber lens trailing an instant dot.
 *
 * Desktop (fine pointer): the lens follows the cursor and grows over any element
 * marked `data-cursor`; `cursor:none` hides the system arrow.
 *
 * Touch (coarse pointer): the same lens + dot follow the finger via touch events
 * — appearing on touchstart, trailing the touch, and fading out shortly after
 * release. No `cursor:none` (there is no system cursor to hide). A touchscreen
 * only has a position while a finger is down, so the lens is naturally a
 * touch-and-drag spotlight rather than an always-on cursor.
 *
 * Marketing surfaces only (mount via MarketingFx). Gated out entirely under
 * reduced-motion; the elements stay `display:none` until this provider adds the
 * matching root class.
 */
export function CursorProvider() {
  const lensRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fine = window.matchMedia('(pointer: fine)').matches
    const root = document.documentElement

    let mx = window.innerWidth / 2
    let my = window.innerHeight / 2
    let lx = mx
    let ly = my
    let raf = 0
    let running = false

    const placeDot = () => {
      const dot = dotRef.current
      if (dot) dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`
    }
    const kick = () => { if (!running) { running = true; raf = requestAnimationFrame(loop) } }
    const loop = () => {
      lx += (mx - lx) * (fine ? 0.18 : 0.28)
      ly += (my - ly) * (fine ? 0.18 : 0.28)
      const lens = lensRef.current
      // On touch, lift the lens above the fingertip so the touch doesn't occlude
      // it — it reads as a spotlight gliding over the hero food, not a blob under
      // your thumb.
      const oy = fine ? 0 : 34
      if (lens) lens.style.transform = `translate3d(${lx}px, ${ly - oy}px, 0) translate(-50%, -50%)`
      if (Math.abs(mx - lx) < 0.4 && Math.abs(my - ly) < 0.4) { running = false; return }
      raf = requestAnimationFrame(loop)
    }

    // ── Desktop: cursor-driven ──
    if (fine) {
      root.classList.add('lx-has-cursor')
      const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; placeDot(); kick() }
      const onOver = (e: PointerEvent) => {
        const hit = (e.target as HTMLElement | null)?.closest('[data-cursor], a, button, [role="button"]')
        root.classList.toggle('lx-cursor-grow', !!hit)
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      document.addEventListener('pointerover', onOver, { passive: true })
      kick()
      return () => {
        window.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerover', onOver)
        cancelAnimationFrame(raf)
        root.classList.remove('lx-has-cursor', 'lx-cursor-grow')
      }
    }

    // ── Touch: finger-driven spotlight ──
    root.classList.add('lx-has-touch-cursor')
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const reveal = () => { clearTimeout(hideTimer); root.classList.add('lx-touch-active') }
    const track = (t: Touch) => { mx = t.clientX; my = t.clientY; placeDot(); kick() }
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return
      // Snap the lens to the first touch so it doesn't fly in from the corner.
      mx = t.clientX; my = t.clientY; lx = mx; ly = my
      placeDot(); reveal(); kick()
    }
    const onMove = (e: TouchEvent) => { const t = e.touches[0]; if (!t) return; reveal(); track(t) }
    const onEnd = () => { hideTimer = setTimeout(() => root.classList.remove('lx-touch-active'), 500) }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
      cancelAnimationFrame(raf)
      clearTimeout(hideTimer)
      root.classList.remove('lx-has-touch-cursor', 'lx-touch-active')
    }
  }, [])

  return (
    <>
      <div ref={lensRef} className="lx-cursor-lens" aria-hidden="true" />
      <div ref={dotRef} className="lx-cursor-dot" aria-hidden="true" />
    </>
  )
}
