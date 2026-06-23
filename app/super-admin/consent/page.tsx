'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ConsentRow {
  id: string
  actor_id: string
  role: string
  action: string
  order_id: string | null
  terms_version: number | null
  agreed_at: string
}
interface OrderInfo { id: string; order_number: string; status: string; delivery_type: string }

// Human labels for the canonical consent actions (lib/consent.ts CONSENT_ACTIONS).
const ACTION_LABEL: Record<string, string> = {
  'customer.pickup.place_order':       'Customer agreed to pickup terms (1h25m hold)',
  'customer.delivery.place_order':     'Customer placed delivery order',
  'customer.delivery.leave_at_gate':   'Customer chose leave-at-gate',
  'customer.order.request_cancel':     'Customer requested cancel/refund',
  'vendor.order.accept':               'Vendor accepted order',
  'vendor.order.reject':               'Vendor rejected order',
  'vendor.order.mark_ready':           'Vendor marked ready',
  'vendor.order.confirm_handover':     'Vendor confirmed handover (code entered)',
  'rider.delivery.accept':             'Rider accepted delivery',
  'rider.delivery.confirm':            'Rider confirmed delivery (code entered)',
  'rider.delivery.leave_at_gate_drop': 'Rider confirmed leave-at-gate drop',
  'onboard.terms_accept':              'Accepted role terms (onboarding)',
}

export default function SuperAdminConsent() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [rows, setRows] = useState<ConsentRow[] | null>(null)

  async function lookup() {
    if (!q.trim()) return
    setLoading(true); setErr(''); setRows(null); setOrder(null)
    try {
      const res = await fetch(`/api/super-admin/consent?order=${encodeURIComponent(q.trim())}`)
      const d = await res.json().catch(() => ({})) as { error?: string; order?: OrderInfo | null; consents?: ConsentRow[] }
      if (!res.ok) { setErr(d.error ?? 'Lookup failed.'); return }
      setOrder(d.order ?? null)
      setRows(d.consents ?? [])
    } catch { setErr('Network error.') } finally { setLoading(false) }
  }

  return (
    <div className="lx-page px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} aria-label="Go back" className="w-11 h-11 rounded-full flex items-center justify-center text-white/50" style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1" style={{ background: '#F5A623', color: '#000' }}>Super Admin</span>
            <h1 className="text-lg font-semibold">Consent record</h1>
          </div>
        </div>

        <p className="text-xs text-white/45 mb-3">
          Append-only record of every binding agreement on an order (the dispute record). Enter an order number (LXF-…) or id.
        </p>

        <div className="flex gap-2 mb-5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void lookup() }}
            placeholder="LXF-2026-XXXXXX"
            className="lx-field flex-1 px-3 py-2.5 text-sm outline-none"
          />
          <button onClick={() => void lookup()} disabled={loading || !q.trim()} className="lx-btn-amber px-4 py-2 text-sm disabled:opacity-40">
            {loading ? '…' : 'Look up'}
          </button>
        </div>

        {err && <p className="text-sm text-red-400 mb-4">{err}</p>}

        {order && (
          <div className="glass-thin p-3 mb-4 text-sm">
            <span className="font-semibold">{order.order_number}</span>
            <span className="text-white/45"> · {order.delivery_type} · {order.status}</span>
          </div>
        )}

        {rows && rows.length === 0 && (
          <p className="text-sm text-white/50">No consent records for this order.</p>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="glass-thin p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/90">{ACTION_LABEL[r.action] ?? r.action}</p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {r.role} · {r.actor_id}{r.terms_version != null && <> · terms v{r.terms_version}</>}
                    </p>
                  </div>
                  <p className="text-xs text-white/40 tabular-nums shrink-0">{new Date(r.agreed_at).toLocaleString('en-NG')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
