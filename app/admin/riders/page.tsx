'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface RiderRow {
  id: string
  phone: string
  full_name: string
  status: string
  is_active: boolean
  approved_at: string | null
  avg_rating: number
  total_deliveries: number
  trust_tier: string
  created_at: string
}

const TRUST_COLORS: Record<string, string> = {
  BRONZE: '#CD7F32',
  SILVER: '#C0C0C0',
  GOLD: '#FFD700',
  DIAMOND: '#B9F2FF',
}

export default function AdminRiders() {
  const router = useRouter()
  const [riders, setRiders] = useState<RiderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [removeTarget, setRemoveTarget] = useState<RiderRow | null>(null)
  const [removing, setRemoving] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchRiders() {
    const res = await fetch('/api/admin/riders')
    if (res.ok) {
      const d = await res.json() as { riders: RiderRow[] }
      setRiders(d.riders)
    }
    setLoading(false)
  }

  useEffect(() => { fetchRiders() }, [])

  async function doAction(riderId: string, action: 'approve' | 'suspend' | 'unsuspend') {
    setActionLoading(riderId + action)
    const res = await fetch(`/api/admin/riders/${riderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`Rider ${action}d`)
      await fetchRiders()
    } else {
      showToast(d.error ?? 'Action failed')
    }
    setActionLoading(null)
  }

  async function confirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    const res = await fetch(`/api/admin/riders/${removeTarget.id}`, { method: 'DELETE' })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`${removeTarget.full_name} removed`)
      setRemoveTarget(null)
      await fetchRiders()
    } else {
      showToast(d.error ?? 'Could not remove rider')
    }
    setRemoving(false)
  }

  return (
    <div className="lx-page px-4 py-8 overflow-hidden">
      {/* Remove confirmation */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center lx-scrim px-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => !removing && setRemoveTarget(null)}>
          <div className="lx-sheet sm:lx-scale-in glass-thick w-full max-w-sm p-6 space-y-4" style={{ borderRadius: 24 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-11 h-11 rounded-2xl shrink-0" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              </span>
              <div>
                <h3 className="font-semibold text-lg">Remove rider?</h3>
                <p className="text-sm text-white/55">{removeTarget.full_name}</p>
              </div>
            </div>
            <p className="text-sm text-white/60">
              This signs <strong>{removeTarget.full_name}</strong> out and stops new deliveries. Their delivery history and wallet records are kept.
            </p>
            <button onClick={confirmRemove} disabled={removing} className="w-full py-3.5 rounded-xl font-semibold disabled:opacity-50" style={{ background: '#EF4444', color: '#fff' }}>
              {removing ? 'Removing…' : 'Yes, remove rider'}
            </button>
            <button onClick={() => setRemoveTarget(null)} disabled={removing} className="w-full py-2.5 text-sm text-white/55 hover:text-white/80 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} aria-label="Go back" className="w-11 h-11 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <h1 className="text-xl font-bold text-white">Riders</h1>
            <p className="text-sm text-white/40">{riders.length} total</p>
          </div>
          <button onClick={() => router.push('/admin/riders/new')}
            className="lx-btn-amber ml-auto px-4 py-2 text-sm">+ Add</button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl lx-skeleton" />
            ))}
          </div>
        ) : riders.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No riders yet</div>
        ) : (
          <div className="space-y-3">
            {riders.map((r) => (
              <div key={r.id} className="glass-thin rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{r.full_name}</p>
                      {r.trust_tier && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold text-black"
                          style={{ background: TRUST_COLORS[r.trust_tier] ?? '#CD7F32' }}>
                          {r.trust_tier}
                        </span>
                      )}
                      {!r.approved_at && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                          Pending
                        </span>
                      )}
                      {r.approved_at && !r.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                          Suspended
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white/40 mt-0.5">{r.phone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-white/40">⭐ {r.avg_rating.toFixed(1)}</p>
                    <p className="text-xs text-white/40 mt-0.5">{r.total_deliveries} deliveries</p>
                  </div>
                </div>

                <div className="text-xs text-white/30 mb-3">
                  Status: <span className="text-white/60">{r.status}</span>
                  {' · '} Joined {new Date(r.created_at).toLocaleDateString('en-NG')}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {!r.approved_at && (
                    <button onClick={() => doAction(r.id, 'approve')}
                      disabled={actionLoading === r.id + 'approve'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
                      {actionLoading === r.id + 'approve' ? '…' : 'Approve'}
                    </button>
                  )}
                  {r.approved_at && r.is_active && (
                    <button onClick={() => doAction(r.id, 'suspend')}
                      disabled={actionLoading === r.id + 'suspend'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      {actionLoading === r.id + 'suspend' ? '…' : 'Suspend'}
                    </button>
                  )}
                  {r.approved_at && !r.is_active && (
                    <button onClick={() => doAction(r.id, 'unsuspend')}
                      disabled={actionLoading === r.id + 'unsuspend'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.2)' }}>
                      {actionLoading === r.id + 'unsuspend' ? '…' : 'Unsuspend'}
                    </button>
                  )}
                  <button onClick={() => setRemoveTarget(r)}
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-red-500/20"
                    style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
