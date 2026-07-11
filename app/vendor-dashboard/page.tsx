'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { waLink, telLink } from '@/lib/contact'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'
import { NotificationBell } from '@/components/notification-bell'
import { DemandBanner } from '@/components/demand-banner'
import { KycPanel } from '@/components/kyc-panel'
import { LaunchCounter } from '@/components/launch-counter'
import { Badge } from '@/components/ui/badge'
import { AlertBanner } from '@/components/ui/alert-banner'
import { RoleTutorial } from '@/components/role-tutorial'
import { GlassSheen } from '@/components/fx'
import { FlyerCenter } from '@/components/vendor-marketing/FlyerCenter'
import { hasUsableLocation } from '@/lib/vendor-location'
import { UtensilsCrossed, Wallet, Star, Settings2, ChevronRight, MapPin, Radio } from 'lucide-react'

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
  phone?: string | null
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  prep_time_minutes: number
  opening_time: string | null
  closing_time: string | null
  logo_url: string | null
  shop_photo_url: string | null
  pickup_enabled: boolean
  pickup_max_concurrent: number
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  subscription_tier?: string | null
  is_premium?: boolean | null
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
  const [toast, setToast] = useState('')
  const [errorBanner, setErrorBanner] = useState<{ title: string; message: string } | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const knownIds = useRef<Set<string>>(new Set())

  // Lightweight error/status toast so a failed action is never silent — a vendor
  // who taps "Mark Ready" and sees nothing happen will tap again, confused.
  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const showError = (title: string, message: string) => setErrorBanner({ title, message })
  const clearError = () => setErrorBanner(null)

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
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) { setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o)); return }
      const d = await res.json().catch(() => ({})) as { error?: string }
      const message = d.error ?? 'Could not update the order. Refresh and try again.'
      showError('Could not update order', message)
      showToast(message)
    } catch {
      showError('Could not update order', 'Network error — check your connection and try again.')
      showToast('Network error — check your connection and try again.')
    }
  }

  const cancelOrder = async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
      if (res.ok) { setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: 'CANCELLED' } : o)); return }
      const d = await res.json().catch(() => ({})) as { error?: string }
      const message = d.error ?? 'Could not cancel the order. Refresh and try again.'
      showError('Could not cancel order', message)
      showToast(message)
    } catch {
      showError('Could not cancel order', 'Network error — check your connection and try again.')
      showToast('Network error — check your connection and try again.')
    }
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
  const isPremium = !!vendor?.is_premium
  const quickActions = [
    { href: '/feed', label: 'Feed', desc: 'Post updates', Icon: Radio },
    { href: '/vendor-dashboard/menu', label: 'Menu', desc: 'Edit prices', Icon: UtensilsCrossed },
    { href: '/vendor-dashboard/videos', label: 'Videos', desc: 'Archive flow', Icon: UtensilsCrossed },
    { href: '/vendor-dashboard/boosts', label: 'Boosts', desc: 'Sponsored push', Icon: Star },
    { href: '/premium', label: 'Premium', desc: 'Plan status', Icon: Star },
    { href: '/vendor-dashboard/settings', label: 'Settings', desc: 'Store info', Icon: Settings2 },
  ]

  return (
    <div className={`lx-page lx-console pb-10 overflow-hidden ${isPremium ? 'bg-gradient-to-b from-[#24170d] via-[#151110] to-[#0b0a09]' : ''}`}>
      <GlassSheen />
      <AlertBanner open={!!errorBanner} title={errorBanner?.title ?? ''} message={errorBanner?.message ?? ''} onDismiss={clearError} />
      {/* Action toast — failures are never silent */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-xl text-sm font-medium lx-enter max-w-[90vw] text-center"
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))', background: 'rgba(239,68,68,0.95)', color: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}
          role="alert">
          {toast}
        </div>
      )}
      {/* Header */}
      <div className="sticky top-0 z-40 lx-surface" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BackButton />
            <div className="min-w-0">
              <p className="text-[10px] text-white/30 uppercase tracking-widest">Vendor</p>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white leading-tight truncate">{vendor?.shop_name ?? '—'}</p>
                {isPremium && (
                  <span className="rounded-full bg-[#F5A623] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-black">
                    Premium
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}
            >
              {vendor?.status === 'OPEN' ? '● Open' : vendor?.status === 'BUSY' ? '● Busy' : '● Closed'}
            </Badge>
            <RoleTutorial role="vendor" variant="icon" />
            <NotificationBell />
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-4">
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="lx-surface p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Dashboard board</p>
                <h2 className="text-2xl font-semibold text-white">Clean view for today</h2>
                <p className="mt-1 text-sm text-white/55">Orders on one side, controls on the other, with the most important actions at the top.</p>
              </div>
              {isPremium && <Badge color="#F5A623">Premium store</Badge>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'New', value: pendingCount, tint: 'rgba(245,166,35,0.16)', color: '#F5A623' },
                { label: 'Preparing', value: prepCount, tint: 'rgba(96,165,250,0.14)', color: '#60a5fa' },
                { label: 'Ready', value: readyCount, tint: 'rgba(74,222,128,0.14)', color: '#4ade80' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 p-3" style={{ background: stat.tint }}>
                  <p className="text-[11px] uppercase tracking-wide text-white/45">{stat.label}</p>
                  <p className="mt-1 text-lg font-semibold lx-nums" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.href}
                  onClick={() => router.push(action.href)}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left transition hover:border-white/15"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-white/80">
                      <action.Icon size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">{action.label}</p>
                      <p className="text-[11px] text-white/40">{action.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lx-surface p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Store status</p>
                <h3 className="text-lg font-semibold text-white">{vendor?.shop_name ?? 'Vendor'}</h3>
              </div>
              <Badge color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}>{vendor?.status ?? 'OPEN'}</Badge>
            </div>
            {vendor && !hasUsableLocation(vendor) ? (
              <button
                onClick={() => router.push('/vendor-dashboard/settings')}
                className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-left"
              >
                <p className="text-sm font-medium text-white">Add your store location</p>
                <p className="mt-1 text-xs text-white/45">Drop a pin so customers and riders can find you faster.</p>
              </button>
            ) : (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-sm font-medium text-white">Location ready</p>
                <p className="mt-1 text-xs text-white/45">Your store is visible on maps and delivery zones.</p>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-wide text-white/40">Queue</p>
                <p className="mt-1 text-white font-semibold">{pendingCount + prepCount + readyCount}</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-wide text-white/40">Open</p>
                <p className="mt-1 text-white font-semibold">{vendor?.status ?? 'OPEN'}</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-wide text-white/40">Premium</p>
                <p className="mt-1 text-white font-semibold">{isPremium ? 'Yes' : 'No'}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 lg:items-start lx-enter">
        {/* Controls — sidebar on desktop (right), BELOW the orders on mobile */}
        <div className="space-y-5 order-2 lg:order-none lg:col-start-2">
        {/* Location nudge — customers & riders can't find a store with no pin. */}
        {vendor && !hasUsableLocation(vendor) && (
          <button
            onClick={() => router.push('/vendor-dashboard/settings')}
            className="w-full text-left lx-surface p-4 flex items-center gap-3 lx-tap"
            style={{ border: '1px solid rgba(245,166,35,0.3)' }}
          >
            <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623' }}>
              <MapPin size={18} strokeWidth={1.9} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Add your store location</p>
              <p className="text-xs text-white/45">Drop a pin so customers & riders can find you.</p>
            </div>
            <ChevronRight size={16} strokeWidth={2} className="text-white/30 shrink-0" />
          </button>
        )}

        {/* Launch counter — self-hides unless the super-admin flag is on */}
        <LaunchCounter />

        {/* Next-hour demand outlook — prep ahead (self-hides until enough history) */}
        <DemandBanner />

        {/* KYC verification — upload & track documents, verified badge */}
        <KycPanel role="vendor" />

        {/* Manage — all navigation consolidated into ONE grouped card instead of
            scattered buttons + a separate settings tile. */}
        <div>
          <p className="lx-mono mb-3 px-1">Manage</p>
          <div className="lx-surface overflow-hidden">
            {[ 
              { href: '/premium',                 Icon: Star,            label: 'Premium plans',      desc: 'See benefits, pricing and entitlement state' },
              { href: '/vendor-dashboard/menu',     Icon: UtensilsCrossed, label: 'Menu & items',     desc: 'Add, edit & price your food' },
              { href: '/vendor-dashboard/videos',   Icon: UtensilsCrossed, label: 'Videos & archive',   desc: 'Manage active, archived and draft videos' },
              { href: '/vendor-dashboard/boosts',   Icon: Star,            label: 'Boosts & ads',      desc: 'Buy verified post boosts and track sponsored posts' },
              { href: '/vendor-dashboard/earnings', Icon: Wallet,          label: 'Earnings & payout', desc: 'Balance, withdrawals & bank' },
              { href: '/vendor-dashboard/reviews',  Icon: Star,            label: 'Reviews',           desc: 'What customers are saying' },
              { href: '/vendor-dashboard/settings', Icon: Settings2,       label: 'Settings',          desc: 'Store, hours, pickup, security' },
            ].map((m, i) => (
              <button
                key={m.href}
                onClick={() => router.push(m.href)}
                className={`w-full flex items-center gap-3 p-4 lx-tap text-left${i > 0 ? ' border-t border-white/[0.06]' : ''}`}
              >
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white/55 shrink-0" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lx-border)' }}>
                  <m.Icon size={18} strokeWidth={1.75} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90">{m.label}</p>
                  <p className="text-xs text-white/40">{m.desc}</p>
                </div>
                <ChevronRight size={16} strokeWidth={2} className="text-white/30 shrink-0" />
              </button>
            ))}
          </div>
        </div>
        </div>

        {/* Orders — FIRST on mobile, left column on desktop */}
        <div className="space-y-4 order-1 lg:order-none lg:col-start-1 lg:row-start-1">
          <FlyerCenter vendorName={vendor?.shop_name ?? 'Vendor'} isPremium={isPremium} />
          <p className="lx-mono px-1">Live</p>
          <div className="lx-surface p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white/85">Shift overview</p>
                <p className="mt-1 text-xs text-white/45">Stay on top of your queue, prep load and pause state from one place.</p>
              </div>
              <Badge
                color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}
              >
                {vendor?.status === 'OPEN' ? '● Open' : vendor?.status === 'BUSY' ? '● Busy' : '● Closed'}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'New', value: pendingCount, tint: 'rgba(245,166,35,0.16)', color: '#F5A623' },
                { label: 'Preparing', value: prepCount, tint: 'rgba(96,165,250,0.14)', color: '#60a5fa' },
                { label: 'Ready', value: readyCount, tint: 'rgba(74,222,128,0.14)', color: '#4ade80' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 p-3" style={{ background: stat.tint }}>
                  <p className="text-[11px] uppercase tracking-wide text-white/45">{stat.label}</p>
                  <p className="mt-1 text-lg font-semibold lx-nums" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-white/40">Order pipeline</p>
                <span className="text-xs text-white/45 lx-nums">{pendingCount + prepCount + readyCount} active</span>
              </div>
              <div className="lx-pipe">
                {pendingCount > 0 && <span style={{ flexGrow: pendingCount, background: 'var(--color-amber)' }} />}
                {prepCount > 0 && <span style={{ flexGrow: prepCount, background: 'var(--lx-blue)' }} />}
                {readyCount > 0 && <span style={{ flexGrow: readyCount, background: 'var(--lx-green)' }} />}
              </div>
            </div>

            {(() => {
              const opts = ['OPEN', 'BUSY', 'CLOSED'] as const
              const idx = Math.max(0, opts.indexOf((vendor?.status ?? 'OPEN') as (typeof opts)[number]))
              const tint = ['#34d399', '#F5A623', '#f87171'][idx]
              return (
                <div className="lx-seg" style={{ ['--seg-n' as string]: 3, ['--seg-i' as string]: idx, ['--seg-tint' as string]: tint } as React.CSSProperties}>
                  <span className="lx-seg-pill" />
                  {opts.map((s) => (
                    <button key={s} className="lx-seg-opt" data-on={vendor?.status === s} disabled={statusBusy} onClick={() => setStatus(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )
            })()}

            <div className="relative">
              <button
                onClick={() => setPauseMenuOpen((v) => !v)}
                className="w-full rounded-xl border border-white/8 py-2.5 text-sm text-white/50"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                Pause orders for…
              </button>
              {pauseMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-2xl border border-white/10" style={{ background: '#111113' }}>
                  {(['15', '30', '60'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => pause(m)}
                      className="w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/8"
                    >
                      {m} minutes
                    </button>
                  ))}
                </div>
              )}
            </div>

            {vendor?.paused_until && new Date(vendor.paused_until) > new Date() && (
              <p className="text-center text-xs text-amber-400">
                Paused until {new Date(vendor.paused_until).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
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
            <div className="lx-surface py-12 text-center">
              <div className="lx-icon-badge w-14 h-14 rounded-2xl mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
              </div>
              <p className="text-sm font-medium text-white/75">All caught up</p>
              <p className="text-xs text-white/40 mt-1">New orders will pop up here with a sound.</p>
            </div>
          ) : (
            <div className="space-y-2.5 lx-stagger">
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
              className="w-full lx-surface rounded-xl px-4 py-3 flex items-center justify-between"
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
      className={`lx-surface relative overflow-hidden rounded-2xl lx-enter ${order.status === 'PENDING' ? 'lx-neworder' : ''}`}
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
          {/* Stacked (not side-by-side): the Collect button is full-width BELOW the
              input so it can never be clipped off the edge of the card on a phone. */}
          <input
            inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={6} value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6)); setCollectErr('') }}
            placeholder="ABC234"
            className="lx-field w-full min-w-0 px-3 py-3 text-lg tracking-[0.4em] text-center font-semibold outline-none uppercase"
          />
          <button onClick={submitCode} disabled={busy || code.length !== 6}
            className="lx-tap w-full mt-2 min-h-[48px] py-3 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--lx-green)', color: '#000' }}>
            {busy ? 'Collecting…' : 'Collect order'}
          </button>
          {collectErr && <p className="text-xs text-red-400 mt-1.5">{collectErr}</p>}
        </div>
      )}

      {/* Actions — destructive Decline kept to the left, primary Accept under the thumb (right) */}
      <div className="pl-5 pr-3 pb-3 pt-1 flex gap-2 justify-end items-center">
        {order.status === 'PENDING' && (
          <>
            <button onClick={() => act(() => onCancel(order.id))} disabled={busy} className="lx-tap px-4 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--lx-red)' }}>Decline</button>
            <button onClick={() => act(() => onUpdate(order.id, 'VENDOR_ACCEPTED'))} disabled={busy} className="lx-btn-amber lx-tap px-5 min-h-[44px] text-xs disabled:opacity-40">{busy ? '…' : 'Accept'}</button>
          </>
        )}
        {order.status === 'VENDOR_ACCEPTED' && (
          <button onClick={() => act(() => onUpdate(order.id, 'PREPARING'))} disabled={busy} className="lx-btn-amber lx-tap px-5 min-h-[44px] text-xs disabled:opacity-40">{busy ? '…' : 'Start Preparing'}</button>
        )}
        {order.status === 'PREPARING' && (
          <button onClick={() => act(() => onUpdate(order.id, 'READY'))} disabled={busy} className="lx-tap px-5 min-h-[44px] rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--lx-green)', color: '#000' }}>{busy ? '…' : 'Mark Ready'}</button>
        )}
        {!isPickup && order.status === 'READY' && (
          <span className="px-2 py-2 text-xs text-white/30">Waiting for rider…</span>
        )}
      </div>
    </div>
  )
}

