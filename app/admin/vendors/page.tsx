'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface VendorRow {
  id: string
  phone: string
  shop_name: string
  owner_name: string
  category: string
  status: string
  subscription_tier: string
  subscription_paid_until: string | null
  is_active: boolean
  approved_at: string | null
  avg_rating: number
  total_ratings: number
  created_at: string
}

const TIER_COLORS: Record<string, string> = {
  FOUNDING: '#F5A623',
  EARLY: '#22C55E',
  STANDARD: '#60A5FA',
}

export default function AdminVendors() {
  const router = useRouter()
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchVendors() {
    const res = await fetch('/api/admin/vendors')
    if (res.ok) {
      const d = await res.json() as { vendors: VendorRow[] }
      setVendors(d.vendors)
    }
    setLoading(false)
  }

  useEffect(() => { fetchVendors() }, [])

  async function doAction(vendorId: string, action: 'approve' | 'suspend' | 'unsuspend') {
    setActionLoading(vendorId + action)
    const res = await fetch(`/api/admin/vendors/${vendorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`Vendor ${action}d`)
      await fetchVendors()
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

      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/admin')} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <h1 className="text-xl font-bold text-white">Vendors</h1>
            <p className="text-sm text-white/40">{vendors.length} total</p>
          </div>
          <button onClick={() => router.push('/admin/vendors/new')}
            className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#F5A623', color: '#000' }}>+ Add</button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : vendors.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No vendors yet</div>
        ) : (
          <div className="space-y-3">
            {vendors.map((v) => (
              <div key={v.id} className="rounded-2xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{v.shop_name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{ background: TIER_COLORS[v.subscription_tier] ?? '#666', color: '#000' }}>
                        {v.subscription_tier}
                      </span>
                      {!v.approved_at && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                          Pending
                        </span>
                      )}
                      {v.approved_at && !v.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                          Suspended
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white/40 mt-0.5">{v.owner_name} · {v.phone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-white/40">{v.category}</p>
                    <p className="text-xs text-white/40 mt-0.5">⭐ {v.avg_rating.toFixed(1)} ({v.total_ratings})</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-white/30 mb-3">
                  <span>Status: <span className="text-white/60">{v.status}</span></span>
                  {v.subscription_paid_until && (
                    <span>· Paid until {new Date(v.subscription_paid_until).toLocaleDateString('en-NG')}</span>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {!v.approved_at && (
                    <button onClick={() => doAction(v.id, 'approve')}
                      disabled={actionLoading === v.id + 'approve'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
                      {actionLoading === v.id + 'approve' ? '…' : 'Approve'}
                    </button>
                  )}
                  {v.approved_at && v.is_active && (
                    <button onClick={() => doAction(v.id, 'suspend')}
                      disabled={actionLoading === v.id + 'suspend'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      {actionLoading === v.id + 'suspend' ? '…' : 'Suspend'}
                    </button>
                  )}
                  {v.approved_at && !v.is_active && (
                    <button onClick={() => doAction(v.id, 'unsuspend')}
                      disabled={actionLoading === v.id + 'unsuspend'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.2)' }}>
                      {actionLoading === v.id + 'unsuspend' ? '…' : 'Unsuspend'}
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
