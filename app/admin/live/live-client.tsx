'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { formatPrice } from '@/lib/money'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'
import type { MapPoint } from './ops-map'

// Leaflet must never SSR (it touches window) — load the map only on the client.
const OpsMap = dynamic(() => import('./ops-map'), {
  ssr: false,
  loading: () => <div className="w-full rounded-2xl" style={{ height: 280, background: 'rgba(255,255,255,0.03)' }} />,
})

const POLL_MS = 6_000

type Severity = 'critical' | 'warn' | 'none'

interface Flag { code: string; severity: 'critical' | 'warn'; label: string }
interface LiveOrder {
  id: string
  order_number: string
  status: string
  payment_status: string | null
  delivery_type: string | null
  delivery_address: string | null
  lat: number | null
  lng: number | null
  total_amount: number
  created_at: string
  stage_since: string
  age_min: number
  severity: Severity
  flags: Flag[]
  vendor_id: string | null
  vendor_name: string | null
  vendor_phone: string | null
  rider_id: string | null
  rider_name: string | null
  rider_phone: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_dispute_count: number
}
interface Summary { total: number; critical: number; warn: number; unassigned: number; disputed: number; mapped: number }
interface Feed { generated_at: string; summary: Summary; orders: LiveOrder[] }

const SEV_COLOR: Record<Severity, string> = { critical: '#EF4444', warn: '#F5A623', none: '#22C55E' }

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', VENDOR_ACCEPTED: 'Accepted', PREPARING: 'Preparing', READY: 'Ready',
  RIDER_ASSIGNED: 'Rider assigned', PICKED_UP: 'Picked up', DELIVERED: 'Delivered', DISPUTED: 'Disputed',
}

// A short beep when a NEW critical order appears, so the admin doesn't have to stare.
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    osc.start(); osc.stop(ctx.currentTime + 0.42)
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch { /* autoplay blocked until first interaction — fine */ }
}

function fmtAge(min: number): string {
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function LiveOpsClient() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [, tick] = useState(0) // drives the live age timers
  const [acting, setActing] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const prevCriticalIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/live', { cache: 'no-store' })
      if (!res.ok) { setError(true); return }
      const d = (await res.json()) as Feed
      setError(false)

      // Alert: a NEW critical order since the last poll → beep (after first load).
      const nowCritical = new Set(d.orders.filter((o) => o.severity === 'critical').map((o) => o.id))
      if (!firstLoad.current && !muted) {
        const isNew = [...nowCritical].some((id) => !prevCriticalIds.current.has(id))
        if (isNew) beep()
      }
      prevCriticalIds.current = nowCritical
      firstLoad.current = false

      setFeed(d)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [muted])

  useEffect(() => {
    load()
    const poll = setInterval(load, POLL_MS)
    const clock = setInterval(() => tick((n) => n + 1), 1_000)
    return () => { clearInterval(poll); clearInterval(clock) }
  }, [load])

  // Tab title screams when something is critical, even on another tab.
  useEffect(() => {
    const base = 'Live Ops · LumeX'
    document.title = feed && feed.summary.critical > 0 ? `🔴 ${feed.summary.critical} critical · ${base}` : base
    return () => { document.title = base }
  }, [feed])

  // Live age = server's stage_since vs the browser clock (re-rendered each tick).
  const ageMin = (o: LiveOrder) => Math.max(0, Math.floor((Date.now() - new Date(o.stage_since).getTime()) / 60_000))

  async function act(orderId: string, key: string, fn: () => Promise<Response>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setActing(`${orderId}:${key}`)
    try {
      const res = await fn()
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert(d.error ?? 'Action failed'); return }
      await load()
    } catch {
      alert('Network error')
    } finally {
      setActing(null)
    }
  }

  const cancelOrder = (o: LiveOrder) =>
    act(o.id, 'cancel', () => fetch(`/api/orders/${o.id}/cancel`, { method: 'POST' }),
      `Cancel order #${o.order_number}? If paid, the customer is refunded.`)

  const suspendCustomer = (o: LiveOrder) => {
    if (!o.customer_phone) { alert('No customer phone on file'); return }
    const reason = window.prompt(`Suspend the customer on #${o.order_number}? Enter a reason:`)
    if (reason === null) return
    return act(o.id, 'suspend', () => fetch('/api/admin/suspend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: o.customer_phone, action: 'suspend', reason: reason || 'Suspicious activity' }),
    }))
  }

  const freezeWallet = (o: LiveOrder, who: 'RIDER' | 'VENDOR') => {
    const userId = who === 'RIDER' ? o.rider_id : o.vendor_id
    if (!userId) { alert(`No ${who.toLowerCase()} on this order`); return }
    const reason = window.prompt(`Freeze the ${who.toLowerCase()}'s wallet (order #${o.order_number}). Reason:`)
    if (reason === null) return
    return act(o.id, `freeze_${who}`, () => fetch('/api/wallet/freeze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, user_type: who, reason: reason || 'Frozen during live investigation' }),
    }))
  }

  const points: MapPoint[] = (feed?.orders ?? [])
    .filter((o) => o.lat != null && o.lng != null)
    .map((o) => ({ id: o.id, order_number: o.order_number, lat: o.lat!, lng: o.lng!, severity: o.severity, status: o.status }))

  const s = feed?.summary

  return (
    <div className="lx-page px-4 py-10 overflow-hidden">
      <div className="relative z-10 mx-auto max-w-2xl lx-enter">
        {/* Header */}
        <div className="mb-5">
          <div className="mb-3 flex items-center justify-between"><BackButton /><LogoutButton /></div>
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold mb-3" style={{ background: '#F5A623', color: '#000' }}>Admin</span>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                Live Operations
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: '#22C55E' }} />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: '#22C55E' }} />
                </span>
              </h1>
              <p className="text-sm text-white/40 mt-0.5">Every active order, live — flags suspicious activity</p>
            </div>
            <button
              onClick={() => setMuted((m) => !m)}
              className="text-xs px-2.5 py-1.5 rounded-lg text-white/60"
              style={{ background: 'rgba(255,255,255,0.06)' }}
              aria-label={muted ? 'Unmute alerts' : 'Mute alerts'}
            >
              {muted ? '🔕 Muted' : '🔔 Alerts on'}
            </button>
          </div>
        </div>

        {/* Alert bar */}
        {s && (s.critical > 0 || s.warn > 0) && (
          <div
            className="rounded-2xl p-4 mb-4 flex items-center gap-3"
            style={s.critical > 0
              ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', boxShadow: '0 0 28px rgba(239,68,68,0.12)' }
              : { background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)' }}
          >
            <span className="text-2xl shrink-0">{s.critical > 0 ? '🔴' : '🟠'}</span>
            <div className="flex-1">
              <p className="font-semibold" style={{ color: s.critical > 0 ? '#EF4444' : '#F5A623' }}>
                {s.critical > 0 ? `${s.critical} order${s.critical !== 1 ? 's' : ''} need attention now` : `${s.warn} order${s.warn !== 1 ? 's' : ''} to watch`}
              </p>
              <p className="text-xs text-white/45 mt-0.5">
                {s.disputed > 0 && `${s.disputed} disputed · `}
                {s.unassigned > 0 && `${s.unassigned} unassigned · `}
                {s.warn > 0 && `${s.warn} slow`}
              </p>
            </div>
          </div>
        )}

        {/* Summary chips */}
        {s && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            <Stat label="Active" value={s.total} />
            <Stat label="Critical" value={s.critical} color={s.critical > 0 ? '#EF4444' : undefined} />
            <Stat label="Unassigned" value={s.unassigned} color={s.unassigned > 0 ? '#F5A623' : undefined} />
            <Stat label="Disputed" value={s.disputed} color={s.disputed > 0 ? '#EF4444' : undefined} />
          </div>
        )}

        {/* Map */}
        {points.length > 0 && (
          <div className="mb-4">
            <OpsMap points={points} />
            <p className="text-[11px] text-white/30 mt-1.5 px-1">
              {points.length} of {s?.total ?? 0} active orders located · destinations (rider live-GPS coming later)
            </p>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-24" style={{ borderRadius: 18 }} />)}</div>
        ) : error ? (
          <div className="glass-thin p-5 text-center text-white/45 text-sm">Couldn’t load live operations. Retrying…</div>
        ) : feed && feed.orders.length === 0 ? (
          <div className="glass-thin p-8 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-white/70 font-medium">No active orders</p>
            <p className="text-white/35 text-sm mt-1">Everything’s settled. New orders appear here live.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feed?.orders.map((o) => {
              const live = ageMin(o)
              const isOpen = openId === o.id
              const canCancel = o.status === 'PENDING' || o.status === 'VENDOR_ACCEPTED'
              return (
                <div key={o.id} className="glass-thin p-4" style={{ borderLeft: `3px solid ${SEV_COLOR[o.severity]}` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SEV_COLOR[o.severity] }} />
                        <p className="font-semibold text-white truncate">#{o.order_number}</p>
                        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)' }}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </div>
                      <p className="text-xs text-white/45 mt-1 truncate">
                        {o.vendor_name ?? 'Vendor'} → {o.customer_name ?? 'Customer'} · {o.delivery_address ?? '—'}
                      </p>
                      <p className="text-xs text-white/35 mt-0.5 truncate">
                        {o.rider_name ? `🛵 ${o.rider_name}` : '🛵 no rider'} · {formatPrice(o.total_amount)} · {o.delivery_type ?? ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums" style={{ color: o.severity === 'critical' ? '#EF4444' : o.severity === 'warn' ? '#F5A623' : 'rgba(255,255,255,0.8)' }}>
                        {fmtAge(live)}
                      </p>
                      <p className="text-[10px] text-white/30">in stage</p>
                    </div>
                  </div>

                  {/* Flags */}
                  {o.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {o.flags.map((f) => (
                        <span key={f.code} className="text-[11px] px-2 py-0.5 rounded-full"
                          style={f.severity === 'critical'
                            ? { background: 'rgba(239,68,68,0.14)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.3)' }
                            : { background: 'rgba(245,166,35,0.12)', color: '#FCD9A1', border: '1px solid rgba(245,166,35,0.28)' }}>
                          {f.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Act toggle */}
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => setOpenId(isOpen ? null : o.id)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}>
                      {isOpen ? 'Close' : 'Act'}
                    </button>
                    {o.customer_phone && (
                      <a href={`https://wa.me/${o.customer_phone.replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-lg text-white/60" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        WhatsApp customer
                      </a>
                    )}
                  </div>

                  {/* Actions */}
                  {isOpen && (
                    <div className="mt-3 pt-3 grid grid-cols-2 gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      {o.status === 'DISPUTED' && (
                        <Link href="/admin/disputes" className="col-span-2 text-center text-xs px-3 py-2 rounded-lg font-medium"
                          style={{ background: 'rgba(239,68,68,0.14)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.3)' }}>
                          Resolve dispute →
                        </Link>
                      )}
                      {canCancel && (
                        <ActBtn busy={acting === `${o.id}:cancel`} onClick={() => cancelOrder(o)} danger>Cancel &amp; refund</ActBtn>
                      )}
                      {o.customer_phone && (
                        <ActBtn busy={acting === `${o.id}:suspend`} onClick={() => suspendCustomer(o)} danger>Suspend customer</ActBtn>
                      )}
                      {o.rider_id && (
                        <ActBtn busy={acting === `${o.id}:freeze_RIDER`} onClick={() => freezeWallet(o, 'RIDER')}>Freeze rider wallet</ActBtn>
                      )}
                      {o.vendor_id && (
                        <ActBtn busy={acting === `${o.id}:freeze_VENDOR`} onClick={() => freezeWallet(o, 'VENDOR')}>Freeze vendor wallet</ActBtn>
                      )}
                      {o.rider_phone && (
                        <a href={`tel:${o.rider_phone}`} className="text-center text-xs px-3 py-2 rounded-lg text-white/70" style={{ background: 'rgba(255,255,255,0.06)' }}>Call rider</a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="glass-thin p-3 text-center">
      <p className="text-xl font-bold tabular-nums" style={{ color: color ?? '#fff' }}>{value}</p>
      <p className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  )
}

function ActBtn({ children, onClick, busy, danger }: { children: React.ReactNode; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="text-xs px-3 py-2 rounded-lg font-medium disabled:opacity-50"
      style={danger
        ? { background: 'rgba(239,68,68,0.12)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.25)' }
        : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}>
      {busy ? '…' : children}
    </button>
  )
}
