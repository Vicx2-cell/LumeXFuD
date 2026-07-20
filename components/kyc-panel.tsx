'use client'

import { useEffect, useState, useCallback } from 'react'
import { docsForRole, type DocState } from '@/lib/kyc'

// Compact, collapsible verification widget for the vendor/rider dashboard. Shows
// a one-line status bar; tap to expand and upload/track each document. Once fully
// verified it stays a small tappable "✓ Verified" line (explainer modal).
export function KycPanel({ role }: { role: 'vendor' | 'rider' }) {
  const docs = docsForRole(role)
  const [state, setState] = useState<Record<string, DocState>>({})
  const [verified, setVerified] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [explain, setExplain] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/face/status')
      const d = await r.json() as { docs?: Record<string, DocState>; verified?: boolean }
      setState(d.docs ?? {}); setVerified(!!d.verified)
    } catch { /* ignore */ } finally { setLoaded(true) }
  }, [])
  useEffect(() => { load() }, [load])

  async function upload(doc: string, file: File) {
    setBusy(doc)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('doc', doc)
      const r = await fetch('/api/auth/face', { method: 'POST', body: fd })
      if (r.ok) await load()
    } finally { setBusy(null) }
  }

  if (!loaded) return null

  const done = docs.filter((d) => state[d.key] && state[d.key] !== 'none').length

  // Verified → tiny line.
  if (verified) {
    return (
      <>
        <button onClick={() => setExplain(true)} className="w-full glass-thin px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm text-white/80">Verification</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>✓ Verified <span className="opacity-60">ⓘ</span></span>
        </button>
        {explain && <Explain onClose={() => setExplain(false)} />}
      </>
    )
  }

  // Not verified → compact bar, tap to expand the uploaders.
  return (
    <div className="glass-thin overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm text-white/80">🪪 Finish verification</span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: '#F5A623' }}>{done}/{docs.length}</span>
          <span className="text-white/40 text-xs">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-white/8">
          {docs.map((d) => {
            const st = state[d.key] ?? 'none'
            return (
              <div key={d.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white flex items-center gap-1.5"><span aria-hidden="true">{d.emoji}</span>{d.label}</p>
                  <p className="text-xs text-white/40">{d.hint}</p>
                </div>
                <div className="shrink-0 text-right">
                  {st === 'verified' ? (
                    <span className="text-xs font-semibold" style={{ color: '#22C55E' }}>✓</span>
                  ) : (
                    <label className="text-xs font-medium cursor-pointer px-3 py-1.5 rounded-lg inline-block" style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}>
                      {busy === d.key ? '…' : st === 'pending' ? 'Replace' : 'Upload'}
                      <input type="file" accept="image/*" capture="user" className="hidden" disabled={busy === d.key}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(d.key, f) }} />
                    </label>
                  )}
                  {st === 'pending' && <p className="text-[10px] text-amber-400 mt-1">Pending</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Explain({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="glass max-w-xs p-5 text-center lx-enter" onClick={(e) => e.stopPropagation()}>
        <p className="text-3xl" aria-hidden="true">✅</p>
        <h3 className="font-bold text-white mt-2 text-lg">Verified account</h3>
        <p className="text-sm text-white/70 mt-2 leading-relaxed">LumeX confirmed your identity. Customers see a ✓ badge by your name — it builds trust, protects you in disputes, and keeps payouts smooth.</p>
        <button onClick={onClose} className="lx-btn-amber w-full py-2.5 text-sm mt-4">Got it</button>
      </div>
    </div>
  )
}
