'use client'

import { useState } from 'react'

// Customer-facing "Verified" badge for vendors & riders. Tap -> a clear plain
// explanation of what it means. Self-contained (own modal); stops click
// propagation so it works inside a vendor-card <Link>.
export function VerifiedBadge({ kind, className }: { kind: 'vendor' | 'rider'; className?: string }) {
  const [open, setOpen] = useState(false)
  const who = kind === 'vendor' ? 'vendor' : 'rider'
  const goldStyle = {
    background: 'linear-gradient(180deg, rgba(255,241,179,0.98) 0%, rgba(245,196,81,0.98) 100%)',
    color: '#1a1200',
    border: '1px solid rgba(255,225,140,0.95)',
    boxShadow: '0 0 0 1px rgba(245,196,81,0.20), 0 8px 20px rgba(245,196,81,0.22), inset 0 1px 0 rgba(255,255,255,0.45)',
  } as const

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] ${className ?? ''}`}
        style={goldStyle}
        aria-label="Verified what does this mean?"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Verified
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-5"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
        >
          <div className="glass max-w-xs p-5 text-center lx-enter" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full" style={goldStyle}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <h3 className="font-bold text-white text-lg mt-2">Verified {who}</h3>
            <p className="text-sm text-white/70 mt-2 leading-relaxed">
              LumeX checked this {who} is real and trusted. {kind === 'vendor' ? 'Order with confidence.' : 'Safe hand-offs.'}
            </p>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }} className="lx-btn-amber w-full py-2.5 text-sm mt-4">Got it</button>
          </div>
        </div>
      )}
    </>
  )
}
