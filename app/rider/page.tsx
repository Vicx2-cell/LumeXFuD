'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { formatPrice } from '@/lib/money'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'
import { RiderHotspots } from '@/components/rider-hotspots'
import { KycPanel } from '@/components/kyc-panel'
import { LaunchCounter } from '@/components/launch-counter'
import { BusinessHours } from '@/components/business-hours'

type RiderStatus = 'ONLINE' | 'OFFLINE' | 'BUSY'

interface AvailableOrder {
  id: string
  order_number: string
  status: string
  delivery_type: 'BIKE' | 'DOOR'
  delivery_address: string
  rider_delivery_cut: number
  created_at: string
  vendors: { shop_name: string } | null
}

interface CurrentOrder {
  id: string
  order_number: string
  status: string
  delivery_type: 'BIKE' | 'DOOR'
  delivery_address: string
  rider_delivery_cut: number
  picked_up_at: string | null
  vendors: { shop_name: string; phone: string } | null
  customers: { phone: string; name: string | null } | null
}

interface WalletBalance {
  total_balance: string        // formatted "₦X,XXX"
  available_balance: string   // formatted "₦X,XXX"
  held_balance: string        // formatted "₦X,XXX"
  available_kobo: number      // raw kobo for logic
  held_kobo: number
  trust_tier: string
  is_frozen: boolean
}

function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
  } catch {
    // AudioContext not available
  }
}

const STATUS_LABELS: Record<string, string> = {
  READY: 'Ready for pickup',
  RIDER_ASSIGNED: 'Assigned to you',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
}

const TRUST_COLORS: Record<string, string> = {
  BRONZE: '#CD7F32',
  SILVER: '#C0C0C0',
  GOLD: '#FFD700',
  DIAMOND: '#B9F2FF',
}

export default function RiderDashboard() {
  const [rider, setRider] = useState<{
    id: string
    full_name: string
    status: RiderStatus
    avg_rating: number
    total_deliveries: number
    opening_time: string | null
    closing_time: string | null
  } | null>(null)
  const [available, setAvailable] = useState<AvailableOrder[]>([])
  const [current, setCurrent] = useState<CurrentOrder | null>(null)
  const [wallet, setWallet] = useState<WalletBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(false)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [toast, setToast] = useState('')
  const prevAvailableIds = useRef<Set<string>>(new Set())

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, walletRes] = await Promise.all([
        fetch('/api/rider/orders'),
        fetch('/api/wallet/balance'),
      ])
      if (ordersRes.ok) {
        const d = await ordersRes.json() as {
          rider: typeof rider
          available: AvailableOrder[]
          current: CurrentOrder | null
        }
        setRider(d.rider)
        setAvailable(d.available)
        setCurrent(d.current)

        // detect new available orders for notification
        const newIds = new Set(d.available.map((o) => o.id))
        const incoming = d.available.filter((o) => !prevAvailableIds.current.has(o.id))
        if (incoming.length > 0 && prevAvailableIds.current.size > 0) {
          beep()
          if (navigator.vibrate) navigator.vibrate([200, 100, 200])
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('New order available!', {
              body: `${incoming[0].vendors?.shop_name ?? 'Order'} — ${formatPrice(incoming[0].rider_delivery_cut)}`,
              icon: '/icons/icon-192-v2.png',
            })
          }
        }
        prevAvailableIds.current = newIds
      }
      if (walletRes.ok) {
        const w = await walletRes.json() as WalletBalance
        setWallet(w)
      }
    } catch (err) {
      console.error('[rider] fetchData failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    // Notification API is absent in iOS Safari (non-PWA) — guard or the page
    // throws at load and the rider dashboard fails to render ("page couldn't load").
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [fetchData])

  // Live updates via polling. The anon Supabase browser client has no session
  // (this app uses a custom JWT in an httpOnly cookie), so Realtime delivers
  // nothing under the orders RLS policies. Poll the service-role API instead,
  // and refetch immediately whenever the tab regains focus.
  useEffect(() => {
    const id = setInterval(() => { void fetchData() }, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') void fetchData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchData])

  async function toggleStatus() {
    if (!rider) return
    const next: RiderStatus = rider.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE'
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/riders/${rider.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) {
        setRider((r) => r ? { ...r, status: next } : r)
        showToast(`You are now ${next.toLowerCase()}`)
      } else {
        showToast(d.error ?? 'Failed to update status')
      }
    } catch (err) {
      console.error('[rider] toggleStatus failed:', err)
      showToast('Network error. Please try again.')
    } finally {
      setStatusLoading(false)
    }
  }

  async function acceptOrder(orderId: string) {
    if (!rider) return
    setAcceptingId(orderId)
    try {
      const res = await fetch(`/api/riders/${rider.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string; order_number?: string }
      showToast(res.ok ? `Order ${d.order_number} accepted!` : (d.error ?? 'Order no longer available'))
    } catch (err) {
      console.error('[rider] acceptOrder failed:', err)
      showToast('Network error. Please try again.')
    } finally {
      // Always refresh and clear the spinner, even if the request errored after
      // the server already assigned the order.
      await fetchData()
      setAcceptingId(null)
    }
  }

  async function updateOrderStatus(orderId: string, status: string) {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) {
        showToast(
          status === 'PICKED_UP' ? 'Marked as picked up'
          : status === 'COMPLETED' ? 'Delivery completed — you can take a new order'
          : 'Marked as delivered'
        )
        await fetchData()
      } else {
        showToast(d.error ?? 'Failed to update order')
      }
    } catch (err) {
      console.error('[rider] updateOrderStatus failed:', err)
      showToast('Network error. Please try again.')
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (loading) {
    return (
      <div className="lx-page px-4 py-6 space-y-4">
        <div className="lx-skeleton h-16" style={{ borderRadius: 16 }} />
        {[1, 2, 3].map((i) => (
          <div key={i} className="lx-skeleton h-24" style={{ borderRadius: 20 }} />
        ))}
      </div>
    )
  }

  if (!rider) {
    return (
      <div className="lx-page flex items-center justify-center">
        <p className="text-white/40">Rider account not found</p>
      </div>
    )
  }

  const isOnline = rider.status === 'ONLINE' || rider.status === 'BUSY'

  return (
    <main className="lx-page pb-10 overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg lx-scale-in"
          role="status" aria-live="polite"
          style={{ background: '#F5A623', color: '#000' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-10 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            <BackButton />
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold mb-2"
                style={{ background: '#F5A623', color: '#000' }}>Rider</span>
              <h1 className="text-xl font-bold text-white">{rider.full_name}</h1>
              <p className="text-sm text-white/45 mt-0.5 flex items-center gap-1.5 tabular-nums">
                {rider.total_deliveries} deliveries
                <span className="text-white/25">·</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#F5A623" stroke="#F5A623" strokeWidth="1" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                {rider.avg_rating?.toFixed(1) ?? '—'}
              </p>
              <a href="/rider/reviews" className="text-xs font-medium mt-1.5 inline-block" style={{ color: '#F5A623' }}>
                See your reviews →
              </a>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
          {/* Online/Offline toggle */}
          <button
            onClick={toggleStatus}
            disabled={statusLoading || rider.status === 'BUSY'}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors"
            style={{
              background: isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isOnline ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: isOnline ? '#22C55E' : 'rgba(255,255,255,0.5)',
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: isOnline ? '#22C55E' : '#666', flexShrink: 0 }} />
            {rider.status === 'BUSY' ? 'Busy' : isOnline ? 'Online' : 'Offline'}
          </button>
            <LogoutButton />
          </div>
        </div>
      </div>

      {/* Launch counter — self-hides unless the super-admin flag is on */}
      <div className="mx-4 mb-5"><LaunchCounter /></div>

      {/* KYC verification — upload & track documents, verified badge */}
      <div className="mx-4 mb-5"><KycPanel role="rider" /></div>

      {/* Working hours */}
      <div className="mx-4 mb-5">
        <BusinessHours
          role="rider"
          id={rider.id}
          initialOpen={rider.opening_time}
          initialClose={rider.closing_time}
        />
      </div>

      {/* Wallet card */}
      {wallet && (
        <div className="glass-thin mx-4 mb-5 p-4 lx-enter">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/40 uppercase tracking-wide">Wallet</p>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{ background: TRUST_COLORS[wallet.trust_tier] ?? '#CD7F32', color: '#000' }}>
              {wallet.trust_tier}
            </span>
          </div>
          <p className="text-2xl font-bold text-white">{wallet.available_balance}</p>
          <p className="text-xs text-white/40 mt-0.5">available</p>
          {wallet.held_kobo > 0 && (
            <p className="text-xs text-amber-400/70 mt-2">
              {wallet.held_balance} held · releases after a short hold
            </p>
          )}
          <a
            href="/rider/wallet"
            className="mt-3 inline-block text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}
          >
            View Wallet →
          </a>
        </div>
      )}

      {/* Current active order */}
      {current && (
        <div className="mx-4 mb-5">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Active order</p>
          <div className="glass p-4 lx-scale-in" style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)' }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-white">{current.order_number}</p>
                <p className="text-xs text-white/50 mt-0.5">{current.vendors?.shop_name}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-lg font-medium"
                style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>
                {STATUS_LABELS[current.status] ?? current.status}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-white/65">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                <span className="truncate">{current.delivery_address}</span>
              </div>
              {current.customers && (
                <div className="flex items-center gap-2 text-sm text-white/65">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <a href={`tel:${current.customers.phone}`} className="text-amber-400">{current.customers.name ?? current.customers.phone}</a>
                </div>
              )}
              {current.vendors?.phone && (
                <div className="flex items-center gap-2 text-sm text-white/65">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40" aria-hidden="true"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M12 22V12"/></svg>
                  <a href={`tel:${current.vendors.phone}`} className="text-amber-400">{current.vendors.phone}</a>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-green-400/60" aria-hidden="true"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span className="text-green-400 font-semibold">{formatPrice(current.rider_delivery_cut)}</span>
              </div>
            </div>

            {current.status === 'RIDER_ASSIGNED' && (
              <button
                onClick={() => updateOrderStatus(current.id, 'PICKED_UP')}
                disabled={updatingStatus}
                className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                style={{ background: '#F5A623', color: '#000' }}
              >
                {updatingStatus ? 'Updating…' : 'Mark as Picked Up'}
              </button>
            )}
            {current.status === 'PICKED_UP' && (
              <button
                onClick={() => updateOrderStatus(current.id, 'DELIVERED')}
                disabled={updatingStatus}
                className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                style={{ background: '#22C55E', color: '#000' }}
              >
                {updatingStatus ? 'Updating…' : 'Mark as Delivered'}
              </button>
            )}
            {current.status === 'DELIVERED' && (
              <button
                onClick={() => updateOrderStatus(current.id, 'COMPLETED')}
                disabled={updatingStatus}
                className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                style={{ background: '#22C55E', color: '#000' }}
              >
                {updatingStatus ? 'Updating…' : 'Complete Delivery ✓'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hotspots — where to position before orders drop (online riders only) */}
      {isOnline && !current && <RiderHotspots />}

      {/* Available orders */}
      <div className="mx-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-white/40 uppercase tracking-wide">Available orders</p>
          {available.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: '#F5A623', color: '#000' }}>
              {available.length}
            </span>
          )}
        </div>

        {!isOnline && (
          <div className="glass-thin p-6 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            </div>
            <p className="font-semibold text-white/75">You&apos;re offline</p>
            <p className="text-sm text-white/40 mt-1">Go online to start catching orders.</p>
            <button
              onClick={toggleStatus}
              disabled={statusLoading}
              className="mt-4 px-6 py-2.5 rounded-xl font-semibold text-sm transition-transform active:scale-95"
              style={{ background: '#22C55E', color: '#000' }}
            >
              Go Online
            </button>
          </div>
        )}

        {isOnline && available.length === 0 && !current && (
          <div className="glass-thin p-6 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.2)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-5l-2.5-6"/><path d="M12 6h3l2 5"/><path d="M6 11h7"/></svg>
            </div>
            <p className="font-semibold text-white/75">Engine&apos;s warm, no orders yet</p>
            <p className="text-sm text-white/40 mt-1">We&apos;ll buzz you the second one is ready.</p>
          </div>
        )}

        {isOnline && available.length > 0 && (
          <div className="space-y-3">
            {available.map((order) => (
              <div key={order.id} className="glass-thin p-4 lx-enter">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-white tabular-nums">{order.order_number}</p>
                    <p className="text-xs text-white/55 mt-0.5">{order.vendors?.shop_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-400 tabular-nums">{formatPrice(order.rider_delivery_cut)}</p>
                    <p className="text-xs text-white/45 mt-0.5">{order.delivery_type === 'BIKE' ? 'Bike' : 'Door'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-white/55 mb-3">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span className="truncate">{order.delivery_address}</span>
                </div>

                <button
                  onClick={() => acceptOrder(order.id)}
                  disabled={acceptingId !== null || !!current}
                  className="lx-btn-amber w-full py-3 text-sm"
                  style={{ borderRadius: 12 }}
                >
                  {acceptingId === order.id ? 'Accepting…' : current ? 'Finish current order first' : 'Accept Order'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Always-reachable logout at the end of the page */}
        <div className="pt-2 pb-6 flex justify-center">
          <LogoutButton />
        </div>
      </div>
    </main>
  )
}
