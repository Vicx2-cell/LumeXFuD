'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'

interface DisputeOrder {
  id: string
  order_number: string
  status: string
  total_amount: number
  delivery_address: string
  delivered_at: string | null
  created_at: string
  vendors: { shop_name: string; phone: string } | null
  customers: { name: string | null; phone: string } | null
}

export default function AdminDisputes() {
  const router = useRouter()
  const [disputes, setDisputes] = useState<DisputeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function fetchDisputes() {
    const res = await fetch('/api/admin/disputes')
    if (res.ok) {
      const d = await res.json() as { disputes: DisputeOrder[] }
      setDisputes(d.disputes)
    }
    setLoading(false)
  }

  useEffect(() => { fetchDisputes() }, [])

  async function resolve(orderId: string, resolution: 'REFUND' | 'NO_ACTION') {
    setResolving(orderId + resolution)
    const res = await fetch(`/api/admin/disputes/${orderId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(resolution === 'REFUND' ? 'Refund issued to customer' : 'Dispute closed — no action')
      await fetchDisputes()
    } else {
      showToast(d.error ?? 'Failed to resolve dispute')
    }
    setResolving(null)
  }

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: '#0A0A0B' }}>
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <h1 className="text-xl font-bold text-white">Disputes</h1>
            {!loading && (
              <p className="text-sm text-white/40">{disputes.length} open — oldest first</p>
            )}
          </div>
        </div>

        {/* Alert banner if any disputes */}
        {!loading && disputes.length > 0 && (
          <div className="rounded-2xl p-3 mb-5 flex items-center gap-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span>⚠️</span>
            <p className="text-sm text-red-400">
              {disputes.length} dispute{disputes.length !== 1 ? 's' : ''} waiting for resolution
            </p>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-44 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : disputes.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-3xl mb-3">✅</p>
            <p className="font-semibold text-white/60">No open disputes</p>
            <p className="text-sm text-white/30 mt-1">All clear</p>
          </div>
        ) : (
          <div className="space-y-4">
            {disputes.map((d) => {
              const deliveredAt = d.delivered_at ? new Date(d.delivered_at) : null
              const ageMinutes = deliveredAt ? Math.round((Date.now() - deliveredAt.getTime()) / 60000) : null

              return (
                <div key={d.id} className="rounded-2xl p-4" style={{ background: '#111113', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-white">{d.order_number}</p>
                      <p className="text-xs text-white/40 mt-0.5">{d.vendors?.shop_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-white">{formatPrice(d.total_amount)}</p>
                      {ageMinutes !== null && (
                        <p className="text-xs text-red-400 mt-0.5">{ageMinutes}m ago</p>
                      )}
                    </div>
                  </div>

                  {/* Customer & vendor contacts */}
                  <div className="space-y-1.5 mb-4 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/40">Customer</span>
                      <a href={`tel:${d.customers?.phone}`} className="text-amber-400 font-medium">
                        {d.customers?.name ?? d.customers?.phone}
                      </a>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/40">Vendor</span>
                      <a href={`tel:${d.vendors?.phone}`} className="text-amber-400 font-medium">
                        {d.vendors?.shop_name}
                      </a>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/40">Address</span>
                      <span className="text-white/70 text-right max-w-[55%] truncate">{d.delivery_address}</span>
                    </div>
                  </div>

                  {/* Resolution actions */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => resolve(d.id, 'REFUND')}
                      disabled={resolving !== null}
                      className="py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
                      style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}
                    >
                      {resolving === d.id + 'REFUND' ? 'Processing…' : 'Refund Customer'}
                    </button>
                    <button
                      onClick={() => resolve(d.id, 'NO_ACTION')}
                      disabled={resolving !== null}
                      className="py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
                      style={{ background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.2)' }}
                    >
                      {resolving === d.id + 'NO_ACTION' ? 'Processing…' : 'No Action'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
