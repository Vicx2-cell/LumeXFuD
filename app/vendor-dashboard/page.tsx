'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { waLink, telLink } from '@/lib/contact'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'
import { DemandBanner } from '@/components/demand-banner'
import { KycPanel } from '@/components/kyc-panel'
import { LaunchCounter } from '@/components/launch-counter'
import { BusinessHours } from '@/components/business-hours'
import { ProfileImageUpload } from '@/components/profile-image-upload'
import { Badge } from '@/components/ui/badge'

interface OrderItem { id: string; name: string; quantity: number; price: number; notes: string | null; addons?: { name: string; price_kobo: number }[] }
interface VendorOrder {
  id: string
  order_number: string
  status: string
  delivery_type: 'BIKE' | 'DOOR' | 'PICKUP'
  delivery_address: string
  total_amount: number
  created_at: string
  pickup_eta_at: string | null
  customers: { phone: string | null; name: string | null; call_phone?: string | null } | null
  order_items: OrderItem[]
}
interface VendorInfo {
  id: string
  shop_name: string
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  prep_time_minutes: number
  opening_time: string | null
  closing_time: string | null
  logo_url: string | null
  shop_photo_url: string | null
  pickup_enabled: boolean
  pickup_max_concurrent: number
}

const ACTIVE = ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY']

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'New Order', VENDOR_ACCEPTED: 'Confirmed',
  PREPARING: 'Preparing', READY: 'Ready for Rider',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show',
}
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#F5A623', VENDOR_ACCEPTED: '#60a5fa',
  PREPARING: '#a78bfa', READY: '#4ade80',
  COMPLETED: 'rgba(255,255,255,0.3)', CANCELLED: '#f87171', NO_SHOW: '#f59e0b',
}

function beep(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.5, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.7)
}

export default function VendorDashboard() {
  const router = useRouter()
  const [vendor, setVendor] = useState<VendorInfo | null>(null)
  const [orders, setOrders] = useState<VendorOrder[]>([])
  const [recent, setRecent] = useState<Pick<VendorOrder, 'id' | 'order_number' | 'status' | 'total_amount' | 'created_at'>[]>([])
  const [loading, setLoading] = useState(true)
  const [statusBusy, setStatusBusy] = useState(false)
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const audioCtx = useRef<AudioContext | null>(null)
  const knownIds = useRef<Set<string>>(new Set())

  const alert = useCallback(() => {
    try {
      const ctx = audioCtx.current ?? new AudioContext()
      audioCtx.current = ctx
      beep(ctx)
    } catch {}
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('New Order — LumeX Fud', {
        body: 'A new order is waiting for you',
        icon: '/icons/icon-192-v2.png',
      })
    }
  }, [])

  const load = useCallback(async (isPoll = false) => {
    try {
      const res = await fetch('/api/vendor/orders')
      if (res.status === 401) { router.push('/auth'); return }
      if (!res.ok) return
      const data = await res.json() as { vendor: VendorInfo; orders: VendorOrder[]; recent: typeof recent }
      setVendor(data.vendor)
      setOrders(data.orders)
      setRecent(data.recent)

      // Detect newly-arrived active orders → alert (sound + notification).
      // Skip on the first load so the existing backlog doesn't beep.
      if (isPoll) {
        const hasNew = data.orders.some(
          (o) => ACTIVE.includes(o.status) && !knownIds.current.has(o.id),
        )
        if (hasNew) alert()
      }
      knownIds.current = new Set(data.orders.map((o) => o.id))
    } finally {
      setLoading(false)
    }
  }, [router, alert])

  useEffect(() => {
    load()
    // iOS Safari has TWO failure modes here, both of which throw at mount and
    // make the dashboard fail to render ("page couldn't load"):
    //   1. Non-PWA tabs: `Notification` is undefined entirely.
    //   2. Several iOS versions: `Notification` IS defined but its legacy
    //      requestPermission() returns undefined (callback API), so chaining
    //      `.catch` on it throws TypeError.
    // Guard the type, confirm the method exists, and only chain `.catch` when the
    // call actually returned a thenable. Whole thing wrapped so it can't crash.
    try {
      if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
        const res = Notification.requestPermission()
        if (res && typeof (res as Promise<unknown>).catch === 'function') {
          ;(res as Promise<unknown>).catch(() => {})
        }
      }
    } catch {
      // Notifications unsupported on this browser — non-fatal.
    }
  }, [load])

  // Live updates via polling. This app authenticates with a custom JWT in an
  // httpOnly cookie, so the anon Supabase browser client has no session and
  // Realtime delivers nothing under the orders RLS policies (which key off
  // auth.jwt()->>'phone'). Poll the service-role API instead, and refetch
  // immediately whenever the tab regains focus so it feels live.
  useEffect(() => {
    const id = setInterval(() => { void load(true) }, 12000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const setStatus = async (status: 'OPEN' | 'BUSY' | 'CLOSED') => {
    if (!vendor) return
    setStatusBusy(true)
    try {
      await fetch(`/api/vendors/${vendor.id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      // Clear the pause timer locally too (backend clears it) so tapping OPEN
      // after a mistaken pause immediately un-pauses without a refresh.
      setVendor((v) => v ? { ...v, status, paused_until: null } : v)
    } finally { setStatusBusy(false) }
  }

  const pause = async (minutes: '15' | '30' | '60') => {
    if (!vendor) return
    setPauseMenuOpen(false)
    setStatusBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}/pause`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      })
      const d = await res.json() as { paused_until: string }
      setVendor((v) => v ? { ...v, status: 'BUSY', paused_until: d.paused_until } : v)
    } finally { setStatusBusy(false) }
  }

  const updateOrder = async (orderId: string, newStatus: string) => {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o))
  }

  const cancelOrder = async (orderId: string) => {
    const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
    if (res.ok) setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: 'CANCELLED' } : o))
  }

  // Pickup handover: enter the customer's 6-character code to release the order.
  // Returns an error string on failure (wrong code, etc.) so the card can show it.
  const collectOrder = async (orderId: string, code: string): Promise<string | null> => {
    const res = await fetch(`/api/orders/${orderId}/collect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (res.ok) {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: 'COMPLETED' } : o))
      return null
    }
    const d = await res.json().catch(() => ({})) as { error?: string }
    return d.error ?? 'Could not collect this order.'
  }

  const savePickup = async (patch: { pickup_enabled?: boolean; pickup_max_concurrent?: number }) => {
    if (!vendor) return
    setVendor((v) => v ? { ...v, ...patch } : v) // optimistic
    await fetch(`/api/vendors/${vendor.id}/pickup-settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {})
  }

  if (loading) {
    return (
      <div className="lx-page flex items-center justify-center">
        <div className="space-y-3 w-full max-w-lg px-4">
          <div className="lx-skeleton h-16" style={{ borderRadius: 16 }} />
          {[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-28" style={{ borderRadius: 20 }} />)}
        </div>
      </div>
    )
  }

  const active = orders.filter((o) => ACTIVE.includes(o.status))
  const pendingCount = orders.filter((o) => o.status === 'PENDING').length
  const prepCount = orders.filter((o) => o.status === 'VENDOR_ACCEPTED' || o.status === 'PREPARING').length
  const readyCount = orders.filter((o) => o.status === 'READY').length

  return (
    <div className="lx-page pb-10 overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-40 glass-thin" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BackButton />
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-widest">Vendor</p>
              <p className="font-semibold text-white leading-tight">{vendor?.shop_name ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}
            >
              {vendor?.status === 'OPEN' ? '● Open' : vendor?.status === 'BUSY' ? '● Busy' : '● Closed'}
            </Badge>
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="max-w-lg lg:max-w-5xl mx-auto px-4 py-4 flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 lg:items-start lx-enter">
        {/* Controls — sidebar on desktop (right), BELOW the orders on mobile */}
        <div className="space-y-5 order-2 lg:order-none lg:col-start-2">
        {/* Launch counter — self-hides unless the super-admin flag is on */}
        <LaunchCounter />

        {/* Next-hour demand outlook — prep ahead (self-hides until enough history) */}
        <DemandBanner />

        {/* KYC verification — upload & track documents, verified badge */}
        <KycPanel role="vendor" />

        {/* Compact entry to the dedicated share page (keeps the dashboard light) */}
        <button onClick={() => router.push('/vendor-dashboard/share')}
          className="w-full glass-thin px-4 py-3 flex items-center justify-between text-left">
          <span className="text-sm font-medium text-white/80">📲 Share your store link</span>
          <span className="lx-amber">→</span>
        </button>

        {/* Store appearance — cover + logo shown to customers */}
        {vendor && (
          <div className="glass-thin p-4 space-y-3">
            <p className="text-xs text-white/40 uppercase tracking-widest">Store appearance</p>
            <ProfileImageUpload
              slot="cover" shape="cover" current={vendor.shop_photo_url}
              deletable
              onUploaded={(u) => setVendor((v) => v ? { ...v, shop_photo_url: u } : v)}
              onRemoved={() => setVendor((v) => v ? { ...v, shop_photo_url: null } : v)}
              label="Cover photo — customers see this on your store"
            />
            <div className="flex items-center gap-3 pt-1">
              <ProfileImageUpload
                slot="avatar" shape="circle" current={vendor.logo_url}
                onUploaded={(u) => setVendor((v) => v ? { ...v, logo_url: u } : v)}
              />
              <div>
                <p className="text-sm font-medium text-white/80">Store logo</p>
                <p className="text-xs text-white/40">Required</p>
              </div>
            </div>
          </div>
        )}

        {/* Opening / closing time */}
        {vendor && (
          <BusinessHours
            role="vendor"
            id={vendor.id}
            initialOpen={vendor.opening_time}
            initialClose={vendor.closing_time}
          />
        )}

        {/* Pickup (Order Ahead) — opt out + pacing cap */}
        {vendor && <PickupSettings vendor={vendor} onSave={savePickup} />}

        <div className="pt-2 flex justify-center">
          <LogoutButton />
        </div>
        </div>

        {/* Orders — FIRST on mobile, left column on desktop */}
        <div className="space-y-4 order-1 lg:order-none lg:col-start-1 lg:row-start-1">
          {/* Quick actions */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'Menu', href: '/vendor-dashboard/menu', icon: <><path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></> },
              { label: 'Earnings', href: '/vendor-dashboard/earnings', icon: <><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></> },
              { label: 'Reviews', href: '/vendor-dashboard/reviews', icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/> },
            ].map((a) => (
              <button key={a.label} onClick={() => router.push(a.href)}
                className="glass-thin lx-tap flex flex-col items-center gap-2 py-3.5 rounded-2xl">
                <span className="lx-icon-badge w-9 h-9 rounded-xl">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{a.icon}</svg>
                </span>
                <span className="text-xs font-semibold text-white/85">{a.label}</span>
              </button>
            ))}
          </div>

          {/* Shop status */}
          <div className="glass-thin p-4 space-y-3">
            <p className="text-xs text-white/40 uppercase tracking-widest">Shop Status</p>
            <div className="grid grid-cols-3 gap-2">
              {(['OPEN', 'BUSY', 'CLOSED'] as const).map((s) => {
                const active_ = vendor?.status === s
                const colors = { OPEN: '#4ade80', BUSY: '#F5A623', CLOSED: '#f87171' }
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    disabled={statusBusy || active_}
                    className="py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                    style={{
                      background: active_ ? colors[s] : 'rgba(255,255,255,0.06)',
                      color: active_ ? '#000' : 'rgba(255,255,255,0.6)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            <div className="relative">
              <button
                onClick={() => setPauseMenuOpen((v) => !v)}
                className="w-full py-2.5 rounded-xl text-sm text-white/50 border border-white/8"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                Pause orders for…
              </button>
              {pauseMenuOpen && (
                <div className="absolute bottom-full mb-1 left-0 right-0 rounded-2xl border border-white/10 overflow-hidden z-10" style={{ background: '#111113' }}>
                  {(['15', '30', '60'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => pause(m)}
                      className="w-full px-4 py-3 text-sm text-left text-white/80 hover:bg-white/8"
                    >
                      {m} minutes
                    </button>
                  ))}
                </div>
              )}
            </div>
            {vendor?.paused_until && new Date(vendor.paused_until) > new Date() && (
              <p className="text-xs text-amber-400 text-center">
                Paused until {new Date(vendor.paused_until).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>

          {/* Order pipeline at a glance */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'New', value: pendingCount, color: 'var(--color-amber)' },
              { label: 'Preparing', value: prepCount, color: 'var(--lx-violet)' },
              { label: 'Ready', value: readyCount, color: 'var(--lx-green)' },
            ].map((s) => (
              <div key={s.label} className="glass-thin rounded-2xl px-3 py-3 text-center">
                <p className="lx-display text-2xl font-bold tabular-nums leading-none" style={{ color: s.value > 0 ? s.color : 'rgba(255,255,255,0.25)' }}>{s.value}</p>
                <p className="text-[11px] text-white/45 mt-1.5">{s.label}</p>
              </div>
            ))}
          </div>

        {/* Active Orders */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-white/80">Active Orders</h2>
            {active.length > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#F5A623', color: '#000' }}>
                {active.length}
              </span>
            )}
          </div>

          {active.length === 0 ? (
            <div className="glass-thin py-12 text-center">
              <div className="lx-icon-badge w-14 h-14 rounded-2xl mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
              </div>
              <p className="text-sm font-medium text-white/75">All caught up</p>
              <p className="text-xs text-white/40 mt-1">New orders will pop up here with a sound.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {active.map((order) => (
                <OrderCard key={order.id} order={order} onUpdate={updateOrder} onCancel={cancelOrder} onCollect={collectOrder} />
              ))}
            </div>
          )}
        </section>

        {/* Recent — collapsed by default, rolls down on tap */}
        {recent.length > 0 && (
          <section>
            <button
              onClick={() => setRecentOpen((v) => !v)}
              aria-expanded={recentOpen}
              className="w-full glass-thin rounded-xl px-4 py-3 flex items-center justify-between"
            >
              <span className="text-sm font-medium text-white/70 flex items-center gap-2">
                Recent orders
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{recent.length}</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-white/30 transition-transform" style={{ transform: recentOpen ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {/* grid-rows 0fr→1fr gives a smooth roll-down without measuring height */}
            <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: recentOpen ? '1fr' : '0fr' }}>
              <div className="overflow-hidden">
                <div className="space-y-1.5 mt-2">
                  {recent.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{o.order_number}</p>
                        <p className="text-xs text-white/30 tabular-nums">{formatPrice(o.total_amount)}</p>
                      </div>
                      <span className="text-xs font-medium shrink-0" style={{ color: STATUS_COLOR[o.status] ?? 'rgba(255,255,255,0.4)' }}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        </div>
      </div>
    </div>
  )
}

function OrderCard({
  order,
  onUpdate,
  onCancel,
  onCollect,
}: {
  order: VendorOrder
  onUpdate: (id: string, status: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
  onCollect: (id: string, code: string) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [collectErr, setCollectErr] = useState('')
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  const isPickup = order.delivery_type === 'PICKUP'
  const itemSummary = (order.order_items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(' · ')

  const submitCode = async () => {
    if (code.length !== 6) { setCollectErr('Enter the customer’s 6-character code.'); return }
    setBusy(true); setCollectErr('')
    try {
      const err = await onCollect(order.id, code)
      if (err) setCollectErr(err)
    } finally { setBusy(false) }
  }

  return (
    <div
      className="glass-thin relative overflow-hidden rounded-2xl lx-enter"
      style={{
        border: `1px solid ${order.status === 'PENDING' ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: order.status === 'PENDING' ? '0 0 20px rgba(245,166,35,0.12), inset 0 1px 0 rgba(255,255,255,0.06)' : undefined,
      }}
    >
      <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: STATUS_COLOR[order.status] ?? 'rgba(255,255,255,0.2)' }} />

      {/* Compact header — tap to expand the full item list */}
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left flex items-center gap-2.5 pl-4 pr-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-white">{order.order_number}</span>
            <span className="text-[11px] font-medium" style={{ color: STATUS_COLOR[order.status] }}>{STATUS_LABEL[order.status]}</span>
          </div>
          <p className="text-xs text-white/45 truncate mt-0.5">{itemSummary}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-white tabular-nums">{formatPrice(order.total_amount)}</p>
          <p className="text-[10px] text-white/30 uppercase tracking-wide">{order.delivery_type}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/30 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="pl-5 pr-4 pb-2 space-y-1 border-t border-white/6 pt-2 lx-enter">
          <p className="text-[11px] text-white/40">{order.delivery_type} · {order.delivery_address}</p>
          {order.order_items?.map((item) => (
            <div key={item.id} className="text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-white/90">{item.quantity}× {item.name}</span>
                {item.notes && <span className="text-xs text-amber-400">· {item.notes}</span>}
              </div>
              {item.addons && item.addons.length > 0 && (
                <p className="text-xs text-white/40 pl-4">+ {item.addons.map((a) => a.name).join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pickup handover: enter the customer's code to release the order */}
      {isPickup && order.status === 'READY' && (
        <div className="px-4 pb-3 pt-1 border-t border-white/6 lx-enter">
          <div className="rounded-lg p-2.5 mb-2 text-xs" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <p className="text-white/45">Order <span className="text-white/80 font-semibold">#{order.order_number}</span>{order.customers?.name ? <> · for <span className="text-white/80">{order.customers.name.split(' ')[0]}</span></> : null}</p>
            {itemSummary && <p className="text-white/70 mt-1">{itemSummary}</p>}
          </div>
          {order.customers?.phone && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-white/45">Running late? Reach {order.customers.name?.split(' ')[0] ?? 'them'}:</span>
              <a href={waLink(order.customers.phone, `Hi${order.customers.name ? ' ' + order.customers.name.split(' ')[0] : ''}, your LumeX order #${order.order_number} is ready to collect.`)}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366' }}>WhatsApp</a>
              <a href={telLink(order.customers.call_phone ?? order.customers.phone)} className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' }}>Call</a>
            </div>
          )}
          <p className="text-xs text-white/50 mb-2">🛍️ Ask the customer to read you their 6-character pickup code (it’s in their app):</p>
          <div className="flex gap-2">
            <input
              inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={6} value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6)); setCollectErr('') }}
              placeholder="ABC234"
              className="lx-field flex-1 px-3 py-2.5 text-base tracking-[0.4em] text-center font-semibold outline-none uppercase"
            />
            <button onClick={submitCode} disabled={busy || code.length !== 6}
              className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 shrink-0" style={{ background: 'var(--lx-green)', color: '#000' }}>
              {busy ? '…' : 'Collect'}
            </button>
          </div>
          {collectErr && <p className="text-xs text-red-400 mt-1.5">{collectErr}</p>}
        </div>
      )}

      {/* Actions */}
      <div className="pl-5 pr-3 pb-3 pt-1 flex gap-2 justify-end">
        {order.status === 'PENDING' && (
          <>
            <button onClick={() => act(() => onCancel(order.id))} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--lx-red)' }}>Decline</button>
            <button onClick={() => act(() => onUpdate(order.id, 'VENDOR_ACCEPTED'))} disabled={busy} className="lx-btn-amber px-4 py-2 text-xs disabled:opacity-40">Accept</button>
          </>
        )}
        {order.status === 'VENDOR_ACCEPTED' && (
          <button onClick={() => act(() => onUpdate(order.id, 'PREPARING'))} disabled={busy} className="lx-btn-amber px-4 py-2 text-xs disabled:opacity-40">Start Preparing</button>
        )}
        {order.status === 'PREPARING' && (
          <button onClick={() => act(() => onUpdate(order.id, 'READY'))} disabled={busy} className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--lx-green)', color: '#000' }}>Mark Ready</button>
        )}
        {!isPickup && order.status === 'READY' && (
          <span className="px-2 py-2 text-xs text-white/30">Waiting for rider…</span>
        )}
      </div>
    </div>
  )
}

// Vendor pickup (order ahead) preferences: offer pickup or not, and a pacing cap
// on simultaneous pickup orders so the kitchen never stacks.
function PickupSettings({
  vendor,
  onSave,
}: {
  vendor: VendorInfo
  onSave: (patch: { pickup_enabled?: boolean; pickup_max_concurrent?: number }) => Promise<void>
}) {
  const [cap, setCap] = useState(String(vendor.pickup_max_concurrent ?? 0))
  const enabled = vendor.pickup_enabled !== false

  return (
    <div className="glass-thin p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80 flex items-center gap-1.5">🛍️ Pickup (Order Ahead)</p>
          <p className="text-xs text-white/45 mt-0.5">Let customers order ahead and collect — no rider, ₦0 delivery.</p>
        </div>
        <button
          type="button" role="switch" aria-checked={enabled}
          onClick={() => onSave({ pickup_enabled: !enabled })}
          className="relative w-12 h-7 rounded-full transition-colors shrink-0"
          style={{ background: enabled ? '#F5A623' : 'rgba(255,255,255,0.15)' }}
        >
          <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: enabled ? 26 : 4 }} />
        </button>
      </div>
      {enabled && (
        <div className="lx-enter">
          <label className="text-xs text-white/50 block mb-1">Max pickup orders at once (pacing)</label>
          <div className="flex gap-2">
            <input
              type="number" min={0} max={100} inputMode="numeric" value={cap}
              onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="lx-field flex-1 px-3 py-2.5 text-sm outline-none tabular-nums"
            />
            <button
              onClick={() => onSave({ pickup_max_concurrent: Math.max(0, Math.min(100, Number(cap) || 0)) })}
              className="lx-btn-amber px-4 py-2 text-xs shrink-0">Save</button>
          </div>
          <p className="text-xs text-white/35 mt-1.5">0 = no limit. Above the cap, new orders get a later “ready by” time instead of stacking.</p>
        </div>
      )}
    </div>
  )
}
