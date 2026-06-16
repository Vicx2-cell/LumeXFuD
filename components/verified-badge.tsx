'use client'

import { useState } from 'react'

// Customer-facing "Verified" badge for vendors & riders. Tap → a clear plain
// explanation of what it means. Self-contained (own modal); stops click
// propagation so it works inside a vendor-card <Link>.
export function VerifiedBadge({ kind, className }: { kind: 'vendor' | 'rider'; className?: string }) {
  const [open, setOpen] = useState(false)
  const who = kind === 'vendor' ? 'vendor' : 'rider'

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${className ?? ''}`}
        style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}
        aria-label="Verified — what does this mean?"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        Verified
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}>
          <div className="glass max-w-xs p-5 text-center lx-enter" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-full mx-auto" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <h3 className="font-bold text-white text-lg mt-2">Verified {who}</h3>
            <p className="text-sm text-white/70 mt-2 leading-relaxed">
              LumeX checked this {who}’s ID — they’re real and trusted. {kind === 'vendor' ? 'Order with confidence.' : 'Safe hand-offs.'}
            </p>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }} className="lx-btn-amber w-full py-2.5 text-sm mt-4">Got it</button>
          </div>
        </div>
      )}
    </>
  )
}
