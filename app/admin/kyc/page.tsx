'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'

interface PendingDoc { key: string; label: string; url: string }
interface PendingUser { phone: string; name: string; role: string; docs: PendingDoc[] }

export default function AdminKycQueue() {
  const router = useRouter()
  const [items, setItems] = useState<PendingUser[]>([])
  const [verified, setVerified] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/kyc/queue')
    if (res.status === 401 || res.status === 403) { router.push('/auth'); return }
    if (res.ok) { const d = await res.json() as { pending: PendingUser[]; verified?: PendingUser[] }; setItems(d.pending); setVerified(d.verified ?? []) }
    setLoading(false)
  }, [router])
  useEffect(() => { load() }, [load])

  async function review(phone: string, doc: string, action: 'approve' | 'reject') {
    setBusy(`${phone}:${doc}`)
    try {
      const res = await fetch('/api/admin/face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, doc, action }),
      })
      if (res.ok) {
        showToast(action === 'approve' ? 'Approved ✓' : 'Rejected')
        await load() // refresh both lists (an approval may complete an account → moves to Verified)
      } else showToast('Could not update')
    } catch { showToast('Network error') }
    finally { setBusy('') }
  }

  async function revoke(phone: string) {
    setBusy(`${phone}:revoke`)
    try {
      const res = await fetch('/api/admin/face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, action: 'revoke' }),
      })
      if (res.ok) { showToast('Verification revoked'); await load() }
      else showToast('Could not revoke')
    } catch { showToast('Network error') }
    finally { setBusy('') }
  }

  const totalDocs = items.reduce((s, u) => s + u.docs.length, 0)

  return (
    <div className="lx-page px-5 py-10 overflow-hidden">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>}
      <div className="mx-auto max-w-2xl lx-enter">
        <div className="mb-6 flex items-center gap-3"><BackButton /><h1 className="text-xl font-bold text-white">KYC review</h1></div>

        {loading ? (
          <p className="text-white/40 text-sm text-center py-10">Loading…</p>
        ) : (
          <>
            {/* ── Pending review ───────────────────────────────── */}
            <p className="text-xs uppercase tracking-wide text-amber-400/80 mb-2 font-semibold">Awaiting review</p>
            {items.length === 0 ? (
              <div className="glass-thin p-6 text-center mb-6">
                <p className="text-2xl mb-1">✅</p>
                <p className="text-white/55 text-sm">Nothing awaiting review.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-white/40 mb-3">{totalDocs} document{totalDocs === 1 ? '' : 's'} from {items.length} account{items.length === 1 ? '' : 's'}</p>
                <div className="space-y-4 mb-8">
                  {items.map((u) => (
                    <div key={u.phone} className="glass-thin p-4">
                      <div className="mb-3">
                        <p className="font-semibold text-white">{u.name}</p>
                        <p className="text-xs text-white/45 uppercase tracking-wide">{u.role} · {u.phone}</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {u.docs.map((d) => (
                          <div key={d.key} className="glass-thin rounded-xl p-3">
                            <p className="text-xs text-white/60 mb-2">{d.label}</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={d.url} alt={d.label} className="w-full h-40 object-cover rounded-lg mb-3" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                            <div className="flex gap-2">
                              <button onClick={() => review(u.phone, d.key, 'approve')} disabled={!!busy} className="flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>Approve</button>
                              <button onClick={() => review(u.phone, d.key, 'reject')} disabled={!!busy} className="flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>Reject</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Verified (revocable) ─────────────────────────── */}
            {verified.length > 0 && (
              <>
                <p className="text-xs uppercase tracking-wide text-green-400/80 mb-2 font-semibold">✓ Verified accounts ({verified.length})</p>
                <div className="space-y-4">
                  {verified.map((u) => (
                    <div key={u.phone} className="glass-thin p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{u.name} <span className="text-green-400 text-xs">✓</span></p>
                          <p className="text-xs text-white/45 uppercase tracking-wide">{u.role} · {u.phone}</p>
                        </div>
                        <button onClick={() => revoke(u.phone)} disabled={!!busy} className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>
                          {busy === `${u.phone}:revoke` ? '…' : 'Revoke'}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {u.docs.map((d) => (
                          <div key={d.key}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={d.url} alt={d.label} className="w-full h-20 object-cover rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                            <p className="text-[10px] text-white/40 mt-1 truncate">{d.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
