'use client'

import { useEffect, useState } from 'react'

/**
 * A short branded reveal shown when the web app is opened: the amber logo mark
 * springs in, the "LumeX Fud" wordmark wipes in amber, then the whole thing
 * lifts away to the app underneath. Shown once per browser session (internal
 * navigations keep the layout mounted, so it only replays on a fresh tab /
 * hard reload), and collapses to a quick fade when reduced-motion is requested.
 */
export function BrandSplash() {
  // Default 'show' renders identically on server + client (no hydration gap) so
  // the splash already covers the very first paint — no flash of the app first.
  const [phase, setPhase] = useState<'show' | 'leaving' | 'gone'>('show')

  useEffect(() => {
    let seen = false
    try { seen = sessionStorage.getItem('lx_splash') === '1' } catch { /* ignore */ }
    if (seen) { setPhase('gone'); return }
    try { sessionStorage.setItem('lx_splash', '1') } catch { /* ignore */ }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const hold = reduce ? 300 : 1750
    const t1 = setTimeout(() => setPhase('leaving'), hold)
    const t2 = setTimeout(() => setPhase('gone'), hold + 600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (phase === 'gone') return null

  return (
    <div className={`lx-splash${phase === 'leaving' ? ' lx-splash--leaving' : ''}`} role="presentation">
      <div className="lx-splash__inner">
        {/* Decorative, instant-paint: a plain img avoids the optimizer round-trip. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512-v2.png" alt="" width={96} height={96} className="lx-splash__mark" />
        <div className="lx-splash__word">
          LumeX<span className="lx-splash__word-amber"> Fud</span>
        </div>
        <div className="lx-splash__tag">Campus life, simplified.</div>
      </div>
    </div>
  )
}
