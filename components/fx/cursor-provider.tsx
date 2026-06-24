'use client'

import { useEffect, useRef } from 'react'

/**
 * Custom pointer: a lerp-follow glowing amber lens trailing an instant dot.
 * The lens grows over any element marked `data-cursor`. Marketing surfaces only
 * (mount via MarketingFx). Renders nothing useful on touch / reduced-motion —
 * the elements stay `display:none` unless `html.lx-has-cursor` is set, which we
 * only add on a fine pointer with motion allowed. `cursor:none` is scoped to
 * `.lx-has-cursor` so it can never apply on touch.
 */
export function CursorProvider() {
  const lensRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return

    const root = document.documentElement
    root.classList.add('lx-has-cursor')

    let mx = window.innerWidth / 2
    let my = window.innerHeight / 2
    let lx = mx
    let ly = my
    let raf = 0
    let running = false

    const onMove = (e: PointerEvent) => {
      mx = e.clientX
      my = e.clientY
      const dot = dotRef.current
      if (dot) dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`
      if (!running) { running = true; raf = requestAnimationFrame(loop) }
    }
    const onOver = (e: PointerEvent) => {
      const hit = (e.target as HTMLElement | null)?.closest('[data-cursor], a, button, [role="button"]')
      root.classList.toggle('lx-cursor-grow', !!hit)
    }
    const loop = () => {
      lx += (mx - lx) * 0.18
      ly += (my - ly) * 0.18
      const lens = lensRef.current
      if (lens) lens.style.transform = `translate3d(${lx}px, ${ly}px, 0) translate(-50%, -50%)`
      // Idle once the lens has caught up to the pointer; pointermove restarts it.
      if (Math.abs(mx - lx) < 0.4 && Math.abs(my - ly) < 0.4) { running = false; return }
      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerover', onOver, { passive: true })
    running = true
    raf = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerover', onOver)
      cancelAnimationFrame(raf)
      root.classList.remove('lx-has-cursor', 'lx-cursor-grow')
    }
  }, [])

  return (
    <>
      <div ref={lensRef} className="lx-cursor-lens" aria-hidden="true" />
      <div ref={dotRef} className="lx-cursor-dot" aria-hidden="true" />
    </>
  )
}
