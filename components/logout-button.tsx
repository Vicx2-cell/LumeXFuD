'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Consistent one-tap logout for every dashboard. Revokes the session
// server-side (POST /api/auth/logout clears the httpOnly cookie + marks the
// sessions row revoked) then returns to the landing page.
export function LogoutButton({ className = '' }: { className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleLogout() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Even if the call fails, fall through to redirect — the cookie is
      // httpOnly and the session is re-checked on every protected request.
    }
    router.push('/')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      disabled={busy}
      className={`h-9 px-3 rounded-full flex items-center gap-1.5 text-xs font-semibold shrink-0 transition-colors disabled:opacity-50 ${className}`}
      style={{ background: 'rgba(239,68,68,0.10)', color: '#F87171', border: '1px solid rgba(239,68,68,0.22)' }}
      aria-label="Log out"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" x2="9" y1="12" y2="12" />
      </svg>
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  )
}
