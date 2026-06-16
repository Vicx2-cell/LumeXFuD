'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'

interface Issue { severity: 'SEV1' | 'SEV2' | 'SEV3'; code: string; message: string }
interface Metrics {
  orders_today: number; paid_orders_today: number; gmv_today_kobo: number
  orders_last_90m: number; riders_online: number; active_disputes: number
  wallet_float_kobo: number; withdrawals_frozen: boolean; ordering_enabled: boolean; is_peak: boolean
}
interface RouteHealth { total: number; probed: number; healthy: number; broken: Array<{ path: string; status: number | string }>; checked_at: string }
interface Snapshot { generated_at: string; status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; db_ok: boolean; metrics: Metrics; routes: RouteHealth | null; issues: Issue[] }
interface Triage {
  severity: string; headline: string; what_broke: string; likely_cause: string
  blast_radius: string; first_action: string; correlated_with_deploy: boolean
}

const STATUS_META = {
  HEALTHY:  { color: '#22C55E', label: 'All systems healthy', emoji: '🟢' },
  DEGRADED: { color: '#F5A623', label: 'Degraded — needs attention', emoji: '🟠' },
  DOWN:     { color: '#EF4444', label: 'Critical — act now', emoji: '🔴' },
}
const SEV_COLOR: Record<Issue['severity'], string> = { SEV1: '#EF4444', SEV2: '#F5A623', SEV3: 'rgba(255,255,255,0.55)' }

export function SentinelClient() {
  const router = useRouter()
  const [data, setData] = useState<{ snapshot: Snapshot; triage: Triage | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState('')

  // setState only inside the promise callback → safe in an effect.
  const fetchData = useCallback(() => {
    return fetch('/api/super-admin/sentinel')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { snapshot: Snapshot; triage: Triage | null } | null) => {
        if (d) { setData(d); setUpdatedAt(new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => { void fetchData() }, 60_000) // live 24/7 view
    return () => clearInterval(id)
  }, [fetchData])

  const snap = data?.snapshot
  const meta = snap ? STATUS_META[snap.status] : STATUS_META.HEALTHY

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50" style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Sentinel</h1>
          <p className="text-xs text-white/40">Your 24/7 platform watch{updatedAt ? ` · updated ${updatedAt}` : ''}</p>
        </div>
        <button onClick={() => { setLoading(true); void fetchData() }} disabled={loading} className="text-xs text-white/45 hover:text-white/80 disabled:opacity-50">
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {loading && !snap ? (
        <div className="h-28 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
      ) : !snap ? (
        <p className="text-sm text-white/45">Couldn&apos;t load the snapshot. Tap refresh.</p>
      ) : (
        <div className="space-y-4">
          {/* Status banner */}
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: `${meta.color}14`, border: `1px solid ${meta.color}44` }}>
            <span className="text-2xl">{meta.emoji}</span>
            <div>
              <p className="font-bold" style={{ color: meta.color }}>{meta.label}</p>
              <p className="text-xs text-white/40">{snap.metrics.is_peak ? 'Peak window' : 'Off-peak'} · DB {snap.db_ok ? 'reachable' : 'unreachable'}</p>
            </div>
          </div>

          {/* AI triage (only when something's wrong) */}
          {data?.triage && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.22)' }}>
              <p className="text-xs font-bold tracking-wide" style={{ color: '#F5A623' }}>🤖 AI TRIAGE</p>
              <p className="text-sm font-semibold text-white">{data.triage.headline}</p>
              <p className="text-sm text-white/70">{data.triage.what_broke}</p>
              <div className="text-xs text-white/55 space-y-1 pt-1">
                <p><span className="text-white/40">Likely cause:</span> {data.triage.likely_cause}</p>
                <p><span className="text-white/40">Who&apos;s affected:</span> {data.triage.blast_radius}</p>
                <p className="text-white/80"><span className="text-white/40">First action:</span> {data.triage.first_action}</p>
              </div>
            </div>
          )}

          {/* Issues */}
          {snap.issues.length > 0 ? (
            <div className="space-y-2">
              {snap.issues.map((it) => (
                <div key={it.code} className="rounded-xl p-3 flex items-start gap-2.5" style={{ background: '#111113', border: `1px solid ${SEV_COLOR[it.severity]}44` }}>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5" style={{ background: `${SEV_COLOR[it.severity]}22`, color: SEV_COLOR[it.severity] }}>{it.severity}</span>
                  <p className="text-sm text-white/80 flex-1">{it.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl p-3 text-sm text-white/50" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
              No issues detected. Everything looks good. ✅
            </div>
          )}

          {/* Metric tiles */}
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Orders today" value={String(snap.metrics.orders_today)} sub={`${snap.metrics.paid_orders_today} paid`} />
            <Tile label="GMV today" value={formatPrice(snap.metrics.gmv_today_kobo)} highlight />
            <Tile label="Orders (90 min)" value={String(snap.metrics.orders_last_90m)} />
            <Tile label="Riders online" value={String(snap.metrics.riders_online)} />
            <Tile label="Open disputes" value={String(snap.metrics.active_disputes)} />
            <Tile label="Wallet float (held)" value={formatPrice(snap.metrics.wallet_float_kobo)} />
            <Tile label="Ordering" value={snap.metrics.ordering_enabled ? 'On' : 'OFF'} danger={!snap.metrics.ordering_enabled} />
            <Tile label="Withdrawals" value={snap.metrics.withdrawals_frozen ? 'FROZEN' : 'Normal'} danger={snap.metrics.withdrawals_frozen} />
            {snap.routes && (
              <Tile
                label="API health"
                value={`${snap.routes.healthy}/${snap.routes.probed} OK`}
                sub={`${snap.routes.total} routes watched`}
                danger={snap.routes.broken.length > 0}
              />
            )}
          </div>
          <p className="text-[11px] text-white/25 text-center">Auto-refreshes every minute · alerts also sent to your phone</p>
        </div>
      )}
    </>
  )
}

function Tile({ label, value, sub, highlight, danger }: { label: string; value: string; sub?: string; highlight?: boolean; danger?: boolean }) {
  const color = danger ? '#EF4444' : highlight ? '#F5A623' : '#fff'
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[11px] text-white/40">{label}</p>
      <p className="text-sm font-semibold truncate mt-0.5" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-white/30">{sub}</p>}
    </div>
  )
}
