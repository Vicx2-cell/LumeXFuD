'use client'

import { useEffect } from 'react'

/**
 * The signature dashboard interaction: an amber light that glows UNDER the
 * frosted glass at the cursor, as if you're holding a torch behind the pane.
 * One delegated pointer listener updates --mx/--my on whichever glassy card
 * (.lx-surface / .lx-statcard) the cursor is over; the CSS ::before renders the
 * radial amber glow there. rAF-throttled, transform/opacity only.
 *
 * Mount-only (renders nothing). No-ops on touch and under reduced-motion — the
 * glass simply stays still there.
 */
export function GlassSheen() {
  useEffect(() => {
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(hover: none)').matches
    ) {
      return
    }

    let raf = 0
    let card: HTMLElement | null = null
    let x = 0
    let y = 0

    const apply = () => {
      raf = 0
      if (!card) return
      const r = card.getBoundingClientRect()
      card.style.setProperty('--mx', `${((x - r.left) / r.width) * 100}%`)
      card.style.setProperty('--my', `${((y - r.top) / r.height) * 100}%`)
    }

    const onMove = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.(
        '.lx-surface, .lx-statcard',
      ) as HTMLElement | null
      if (!target) return
      card = target
      x = e.clientX
      y = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
