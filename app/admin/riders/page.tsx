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

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: '#0A0A0B' }}>
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <h1 className="text-xl font-bold text-white">Riders</h1>
            <p className="text-sm text-white/40">{riders.length} total</p>
          </div>
          <button onClick={() => router.push('/admin/riders/new')}
            className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#F5A623', color: '#000' }}>+ Add</button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : riders.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No riders yet</div>
        ) : (
          <div className="space-y-3">
            {riders.map((r) => (
              <div key={r.id} className="rounded-2xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
