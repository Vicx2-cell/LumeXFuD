'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/money'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'
import { RiderHotspots } from '@/components/rider-hotspots'
import { KycPanel } from '@/components/kyc-panel'
import { LaunchCounter } from '@/components/launch-counter'
import { BusinessHours } from '@/components/business-hours'
import { ProfileImageUpload } from '@/components/profile-image-upload'
import { useFeatures } from '@/lib/use-features'
import { waLink } from '@/lib/contact'

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
  leave_at_gate: boolean | null
  delivery_photo_url: string | null
  vendors: { shop_name: string; phone: string; call_phone?: string | null } | null
  customers: { phone: string; name: string | null; avatar_url: string | null; call_phone?: string | null } | null
  order_items: { name: string; quantity: number }[] | null
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
  const features = useFeatures()
  const [rider, setRider] = useState<{
    id: string
    full_name: string
    status: RiderStatus
    avg_rating: number
    total_deliveries: number
    opening_time: string | null
    closing_time: string | null
    avatar_url: string | null
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

  // Delivery handover: confirm with the customer's code, or (if they opted into
  // leave-at-gate) confirm the drop. Returns an error string on failure.
  async function confirmDelivery(orderId: string, payload: { code?: string; leave_at_gate?: boolean }): Promise<string | null> {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/deliver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) { showToast('Delivery confirmed'); await fetchData(); return null }
      return d.error ?? 'Could not confirm delivery.'
    } catch { return 'Network error. Please try again.' }
    finally { setUpdatingStatus(false) }
  }

  // OPTIONAL leave-at-gate proof photo upload (never required).
  async function uploadGatePhoto(orderId: string, file: File): Promise<string | null> {
    const form = new FormData(); form.append('file', file)
    const res = await fetch(`/api/orders/${orderId}/delivery-photo`, { method: 'POST', body: form })
    const d = await res.json().catch(() => ({})) as { error?: string }
    if (res.ok) { showToast('Proof photo added'); await fetchData(); return null }
    return d.error ?? 'Could not upload photo.'
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
          <div className="flex items-start gap-3">
            <BackButton />
            <ProfileImageUpload slot="avatar" shape="circle" size={56} current={rider.avatar_url}
              onUploaded={(u) => setRider((r) => r ? { ...r, avatar_url: u } : r)} />
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
              <a href="/rider/reviews" className="lx-amber text-xs font-medium mt-1.5 inline-block">
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
            className="lx-card-amber lx-amber mt-3 inline-block text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            View Wallet →
          </a>
        </div>
      )}

      {/* Current active order */}
      {current && (
        <div className="mx-4 mb-5">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Active order</p>
          <div className="glass lx-card-amber-soft p-4 lx-scale-in">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-white">{current.order_number}</p>
                <p className="text-xs text-white/50 mt-0.5">{current.vendors?.shop_name}</p>
              </div>
              <span className="lx-card-amber lx-amber text-xs px-2 py-1 rounded-lg font-medium">
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
                  <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0 w-14">Customer</span>
                  {current.customers.avatar_url ? (
                    <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0" style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
                      <Image src={current.customers.avatar_url} alt="" fill className="object-cover" sizes="28px" />
                    </div>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  )}
                  <a href={`tel:${current.customers.call_phone ?? current.customers.phone}`} className="text-amber-400">{current.customers.name ?? current.customers.phone}</a>
                  <a
                    href={waLink(current.customers.phone, `Hi${current.customers.name ? ' ' + current.customers.name.split(' ')[0] : ''}, I’m your LumeX rider for order #${current.order_number}. I’m on my way!`)}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto text-[11px] px-2 py-1 rounded-lg font-medium shrink-0" style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366' }}
                  >WhatsApp</a>
                </div>
              )}
              {current.vendors?.phone && (
                <div className="flex items-center gap-2 text-sm text-white/65">
                  <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0 w-14">Vendor</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40" aria-hidden="true"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M12 22V12"/></svg>
                  <a href={`tel:${current.vendors.call_phone ?? current.vendors.phone}`} className="text-amber-400 truncate">{current.vendors.call_phone ?? current.vendors.phone}</a>
                  <a
                    href={waLink(current.vendors.phone, `Hi, I’m the LumeX rider for order #${current.order_number}. Is it ready for pickup?`)}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto text-[11px] px-2 py-1 rounded-lg font-medium shrink-0" style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366' }}
                  >WhatsApp</a>
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
                className="lx-btn-amber w-full py-3 text-sm"
              >
                {updatingStatus ? 'Updating…' : 'Mark as Picked Up'}
              </button>
            )}
            {current.status === 'PICKED_UP' && (
              features.delivery_handover_v1 === true ? (
                <DeliverPanel
                  order={current}
                  busy={updatingStatus}
                  onConfirm={confirmDelivery}
                  onUploadPhoto={uploadGatePhoto}
                />
              ) : (
                <button
                  onClick={() => updateOrderStatus(current.id, 'DELIVERED')}
                  disabled={updatingStatus}
                  className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                  style={{ background: '#22C55E', color: '#000' }}
                >
                  {updatingStatus ? 'Updating…' : 'Mark as Delivered'}
                </button>
              )
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
            <div className="lx-icon-badge w-14 h-14 rounded-2xl mb-3">
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

      </div>

      {/* Setup & account — below the work so orders stay up top */}
      <div className="mx-4 mt-5"><LaunchCounter /></div>
      <div className="mx-4 mt-5"><KycPanel role="rider" /></div>
      <div className="mx-4 mt-5">
        <BusinessHours
          role="rider"
          id={rider.id}
          initialOpen={rider.opening_time}
          initialClose={rider.closing_time}
        />
      </div>

      <div className="pt-4 pb-6 flex justify-center">
        <LogoutButton />
      </div>
    </main>
  )
}

// Delivery handover panel (delivery_handover_v1). Default: enter the customer's
// 6-char code. If the customer opted into leave-at-gate: confirm the drop, with an
// OPTIONAL proof photo (never required). Shows fulfillment-only data — order id +
// customer first name (no full phone/address/payment here) — per Invariant I5.
function DeliverPanel({
  order, busy, onConfirm, onUploadPhoto,
}: {
  order: CurrentOrder
  busy: boolean
  onConfirm: (orderId: string, payload: { code?: string; leave_at_gate?: boolean }) => Promise<string | null>
  onUploadPhoto: (orderId: string, file: File) => Promise<string | null>
}) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState(false)
  const firstName = order.customers?.name?.split(' ')[0] ?? 'the customer'

  const submitCode = async () => {
    if (code.length !== 6) { setErr('Enter the customer’s 6-character code.'); return }
    setErr('')
    const e = await onConfirm(order.id, { code })
    if (e) setErr(e)
  }
  const confirmGate = async () => {
    setErr('')
    const e = await onConfirm(order.id, { leave_at_gate: true })
    if (e) setErr(e)
  }
  const pickPhoto = async (file: File | null) => {
    if (!file) return
    setUploading(true); setErr('')
    const e = await onUploadPhoto(order.id, file)
    setUploading(false)
    if (e) setErr(e)
  }

  // One-tap "I've arrived" message to the customer (no code in the text — I3). This
  // is the rider's first move at the door, and the fallback when the customer isn't
  // out yet: ping them on WhatsApp before anything stalls.
  const arrivedWa = order.customers?.phone
    ? waLink(order.customers.phone, `Hi${firstName !== 'the customer' ? ' ' + firstName : ''}, I’ve arrived with your LumeX order #${order.order_number}. Please come out to collect — or open the LumeX app and read me your collection code.`)
    : null

  // Order summary the rider checks against the bag before confirming (fulfillment
  // data only — items, order id, customer first name).
  const summary = (
    <div className="rounded-lg p-2.5 mb-2 text-xs" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <p className="text-white/45">Order <span className="text-white/80 font-semibold">#{order.order_number}</span> · for <span className="text-white/80">{firstName}</span></p>
      {order.order_items && order.order_items.length > 0 && (
        <p className="text-white/70 mt-1">{order.order_items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}</p>
      )}
    </div>
  )

  if (order.leave_at_gate) {
    return (
      <div className="rounded-xl p-3 mt-1" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.2)' }}>
        {summary}
        <p className="text-xs text-white/65 mb-2">📷 Leave-at-gate for <span className="font-semibold text-white/90">{firstName}</span> — drop it at the gate. A proof photo is optional.</p>
        {arrivedWa && (
          <a href={arrivedWa} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-2.5 mb-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(37,211,102,0.16)', color: '#25D366' }}>
            📲 Tell {firstName} you’ve arrived (WhatsApp)
          </a>
        )}
        <div className="flex gap-2">
          <label className="flex-1 text-center py-2.5 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' }}>
            {uploading ? 'Uploading…' : order.delivery_photo_url ? '✓ Photo added — retake' : 'Add proof photo'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)} disabled={uploading || busy} />
          </label>
          <button onClick={confirmGate} disabled={busy} className="px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50 shrink-0" style={{ background: '#22C55E', color: '#000' }}>
            {busy ? '…' : 'Confirm drop'}
          </button>
        </div>
        {err && <p className="text-xs text-red-400 mt-1.5">{err}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-xl p-3 mt-1" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.2)' }}>
      {summary}
      {arrivedWa && (
        <a href={arrivedWa} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-2.5 mb-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(37,211,102,0.16)', color: '#25D366' }}>
          📲 Tell {firstName} you’ve arrived (WhatsApp)
        </a>
      )}
      <p className="text-xs text-white/65 mb-2">🔑 Ask <span className="font-semibold text-white/90">{firstName}</span> for their 6-character delivery code (it’s in their app):</p>
      <div className="flex gap-2">
        <input
          inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={6} value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6)); setErr('') }}
          placeholder="ABC234"
          className="lx-field flex-1 px-3 py-2.5 text-base tracking-[0.4em] text-center font-semibold outline-none uppercase"
        />
        <button onClick={submitCode} disabled={busy || code.length !== 6} className="px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50 shrink-0" style={{ background: '#22C55E', color: '#000' }}>
          {busy ? '…' : 'Confirm'}
        </button>
      </div>
      {err && <p className="text-xs text-red-400 mt-1.5">{err}</p>}
    </div>
  )
}
