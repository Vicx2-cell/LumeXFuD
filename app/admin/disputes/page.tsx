'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'

interface DisputeRow {
  reason: string
  description: string | null
  customer_photo_url: string | null
  ai_triage: DisputeBrief | null
}

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
  disputes: DisputeRow[] | DisputeRow | null
}

/** orders→disputes embeds as an array (or object); normalise to the single row. */
function disputeRow(d: DisputeOrder): DisputeRow | null {
  if (!d.disputes) return null
  return Array.isArray(d.disputes) ? (d.disputes[0] ?? null) : d.disputes
}

interface DisputeBrief {
  summary: string
  customer_claim: string
  key_facts: string[]
  risk_flags: string[]
  suggested_resolution: 'REFUND' | 'NO_ACTION' | 'PARTIAL' | 'NEEDS_MORE_INFO'
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

const RESOLUTION_META: Record<DisputeBrief['suggested_resolution'], { label: string; color: string }> = {
  REFUND:         { label: 'Lean: Refund customer', color: '#EF4444' },
  NO_ACTION:      { label: 'Lean: No action (favour vendor)', color: '#22C55E' },
  PARTIAL:        { label: 'Lean: Partial / goodwill', color: '#F5A623' },
  NEEDS_MORE_INFO:{ label: 'Needs more info', color: 'rgba(255,255,255,0.6)' },
}

export default function AdminDisputes() {
  const router = useRouter()
  const [disputes, setDisputes] = useState<DisputeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [briefs, setBriefs] = useState<Record<string, DisputeBrief>>({})
  const [analyzing, setAnalyzing] = useState<string | null>(null)

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

  async function analyze(orderId: string) {
    setAnalyzing(orderId)
    try {
      const res = await fetch(`/api/admin/disputes/${orderId}/analyze`, { method: 'POST' })
      const d = await res.json() as { brief?: DisputeBrief; error?: string }
      if (res.ok && d.brief) setBriefs((b) => ({ ...b, [orderId]: d.brief! }))
      else showToast(d.error ?? 'Could not analyze this dispute')
    } catch {
      showToast('Network error — try again')
    } finally {
      setAnalyzing(null)
    }
  }

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
    <div className="lx-page px-4 py-8">
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
              <div key={i} className="h-44 rounded-2xl lx-skeleton" />
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
              const row = disputeRow(d)
              // Prefer a freshly re-run analysis; otherwise the concierge's stored triage.
              const brief = briefs[d.id] ?? row?.ai_triage ?? null

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

                  {/* What the customer reported (+ optional photo) */}
                  {row && (row.reason || row.description || row.customer_photo_url) && (
                    <div className="mb-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-[11px] uppercase tracking-wide text-white/35 mb-1">Customer reported</p>
                      {row.reason && <p className="text-sm text-white/85">{row.reason}</p>}
                      {row.description && <p className="text-xs text-white/55 mt-1">{row.description}</p>}
                      {row.customer_photo_url && (
                        <a href={row.customer_photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 mt-1.5 inline-block">View photo →</a>
                      )}
                    </div>
                  )}

                  {/* AI triage — the concierge's read is shown automatically; re-run is optional */}
                  {brief ? (
                    <DisputeBriefPanel brief={brief} />
                  ) : (
                    <button
                      onClick={() => analyze(d.id)}
                      disabled={analyzing !== null}
                      className="lx-card-amber lx-amber w-full mb-3 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {analyzing === d.id ? 'Analyzing…' : '🤖 AI analysis'}
                    </button>
                  )}

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

function DisputeBriefPanel({ brief }: { brief: DisputeBrief }) {
  const meta = RESOLUTION_META[brief.suggested_resolution]
  return (
    <div className="lx-card-amber-soft mb-3 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="lx-amber text-xs font-bold tracking-wide">🤖 AI ANALYSIS</span>
        <span className="text-[10px] text-white/30">advisory · you decide</span>
      </div>

      <p className="text-sm text-white/85">{brief.summary}</p>

      {brief.key_facts.length > 0 && (
        <ul className="space-y-1">
          {brief.key_facts.map((f, i) => (
            <li key={i} className="text-xs text-white/60 flex gap-1.5"><span className="text-white/30">•</span><span>{f}</span></li>
          ))}
        </ul>
      )}

      {brief.risk_flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {brief.risk_flags.map((flag, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>⚠ {flag}</span>
          ))}
        </div>
      )}

      <div className="pt-1 border-t border-white/8 flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[11px] text-white/40">{brief.confidence} confidence</span>
      </div>
      <p className="text-xs text-white/55 leading-relaxed">{brief.reasoning}</p>
    </div>
  )
}
