'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState, useCallback } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/money'
import { CountUp, GlassSheen } from '@/components/fx'
import { Settings2, ChevronRight } from 'lucide-react'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'
import { NotificationBell } from '@/components/notification-bell'
import { RiderHotspots } from '@/components/rider-hotspots'
import { KycPanel } from '@/components/kyc-panel'
import { LaunchCounter } from '@/components/launch-counter'
import { ProfileImageUpload } from '@/components/profile-image-upload'
import { AlertBanner } from '@/components/ui/alert-banner'
import { RoleTutorial } from '@/components/role-tutorial'
import { useFeatures } from '@/lib/use-features'
import { waLink } from '@/lib/contact'
import { formatAddressForRider } from '@/lib/delivery-address'
import { directionsUrl, hasPin } from '@/lib/maps'

type RiderStatus = 'ONLINE' | 'OFFLINE' | 'BUSY'

interface AvailableOrder {
  id: string
  order_number: string
  status: string
  delivery_type: 'BIKE' | 'DOOR'
  delivery_address: string
  delivery_latitude?: number | null
  delivery_longitude?: number | null
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
  delivery_latitude?: number | null
  delivery_longitude?: number | null
  rider_delivery_cut: number
  picked_up_at: string | null
  leave_at_gate: boolean | null
  delivery_photo_url: string | null
  vendors: {
    shop_name: string; phone: string; call_phone?: string | null
    address_text?: string | null; landmark?: string | null
    latitude?: number | null; longitude?: number | null; location_photo_url?: string | null
  } | null
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

// Render the drop-off as a bold lodge line + scannable chips (Block B, Room 12,
// landmarks) parsed from the composed address — so the rider sees exactly where
// to go at a glance instead of one truncated run-on line. `emphasis` makes it
// bigger on the active order the rider is actually delivering.
function RiderAddress({ address, emphasis = false }: { address: string; emphasis?: boolean }) {
  const { primary, chips } = formatAddressForRider(address)
  return (
    <div className="flex items-start gap-2">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 mt-0.5 ${emphasis ? 'text-[#F5A623]' : 'text-white/40'}`} aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      <div className="min-w-0">
        <p className={emphasis ? 'text-sm font-semibold text-white leading-snug' : 'text-sm text-white/65 leading-snug'}>{primary}</p>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {chips.map((c, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-md font-medium"
                style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.2)' }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
  const [errorPopout, setErrorPopout] = useState<{ title: string; message: string } | null>(null)
  const prevAvailableIds = useRef<Set<string>>(new Set())

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const showErrorPopout = (title: string, message: string) => { setErrorPopout({ title, message }) }
  const clearErrorPopout = () => { setErrorPopout(null) }

  function explainActionFailure(
    fallback: string,
    payload: { error?: string; code?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> } } = {},
  ) {
    const parts: string[] = []
    if (payload.error) parts.push(payload.error)

    const fieldErrors = payload.details?.fieldErrors
    const formErrors = payload.details?.formErrors ?? []
    const statusError = fieldErrors?.status?.[0]
    const generalError = formErrors[0]

    if (payload.code === 'INVALID_STATUS' && statusError) parts.push(statusError)
    if (payload.code === 'INVALID_STATUS' && generalError) parts.push(generalError)
    if (parts.length === 0) parts.push(fallback)
    return parts.join(' ')
  }

  async function captureGps(): Promise<{ latitude?: number; longitude?: number; gps_accuracy?: number } | null> {
    if (!('geolocation' in navigator)) return null
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            gps_accuracy: pos.coords.accuracy ?? undefined,
          })
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      )
    })
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
      const d = await res.json().catch(() => ({})) as { error?: string; code?: string }
      if (res.ok) {
        clearErrorPopout()
        setRider((r) => r ? { ...r, status: next } : r)
        showToast(`You are now ${next.toLowerCase()}`)
      } else {
        const message = d.error ?? 'Failed to update status'
        showErrorPopout('Could not change rider status', message)
        showToast(message)
      }
    } catch (err) {
      console.error('[rider] toggleStatus failed:', err)
      showErrorPopout('Could not change rider status', 'Network error. Please try again.')
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
      if (res.ok) {
        clearErrorPopout()
        showToast(`Order ${d.order_number} accepted!`)
      } else {
        const message = d.error ?? 'Order no longer available'
        showErrorPopout('Could not accept order', message)
        showToast(message)
      }
    } catch (err) {
      console.error('[rider] acceptOrder failed:', err)
      showErrorPopout('Could not accept order', 'Network error. Please try again.')
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
      const gps = await captureGps()
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...gps }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> } }
      if (res.ok) {
        clearErrorPopout()
        showToast(
          status === 'PICKED_UP' ? 'Marked as picked up'
          : status === 'COMPLETED' ? 'Delivery completed — you can take a new order'
          : 'Marked as delivered'
        )
        await fetchData()
      } else if (d.code === 'ORDER_AUTO_CANCELLED') {
        const message = d.error ?? 'This order was auto-cancelled before pickup.'
        showErrorPopout('Pickup could not be completed', message)
        showToast(message)
        await fetchData()
      } else {
        const message = explainActionFailure('Failed to update order', d)
        showErrorPopout(
          status === 'PICKED_UP' ? 'Could not mark pickup'
          : status === 'COMPLETED' ? 'Could not complete delivery'
          : 'Could not update order',
          message,
        )
        showToast(message)
        await fetchData()
      }
    } catch (err) {
      console.error('[rider] updateOrderStatus failed:', err)
      showErrorPopout(
        status === 'PICKED_UP' ? 'Could not mark pickup'
        : status === 'COMPLETED' ? 'Could not complete delivery'
        : 'Could not update order',
        'Network error. Please try again.',
      )
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
      const gps = await captureGps()
      const res = await fetch(`/api/orders/${orderId}/deliver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...gps }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) { clearErrorPopout(); showToast('Delivery confirmed'); await fetchData(); return null }
      const message = d.error ?? 'Could not confirm delivery.'
      showErrorPopout('Could not confirm delivery', message)
      return message
    } catch {
      showErrorPopout('Could not confirm delivery', 'Network error. Please try again.')
      return 'Network error. Please try again.'
    }
    finally { setUpdatingStatus(false) }
  }

  // OPTIONAL leave-at-gate proof photo upload (never required).
  async function uploadGatePhoto(orderId: string, file: File): Promise<string | null> {
    const form = new FormData(); form.append('file', file)
    const res = await fetch(`/api/orders/${orderId}/delivery-photo`, { method: 'POST', body: form })
    const d = await res.json().catch(() => ({})) as { error?: string }
    if (res.ok) { clearErrorPopout(); showToast('Proof photo added'); await fetchData(); return null }
    const message = d.error ?? 'Could not upload photo.'
    showErrorPopout('Could not upload photo', message)
    return message
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
    // Centered app column: flush on mobile, a framed column on desktop (matches the
    // customer app + vendor dashboard) instead of sprawling edge-to-edge on wide
    // screens. The faint side borders read as an intentional surface on ≥sm.
    <main
      className="lx-page lx-console overflow-hidden mx-auto w-full max-w-lg lg:max-w-2xl sm:border-x sm:border-white/5"
      style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
    >
      <GlassSheen />
      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg lx-scale-in max-w-[92vw] text-center"
          role="status" aria-live="polite"
          style={{ background: '#F5A623', color: '#000', top: 'calc(1rem + env(safe-area-inset-top))' }}>
          {toast}
        </div>
      )}
      <AlertBanner
        open={!!errorPopout}
        title={errorPopout?.title ?? ''}
        message={errorPopout?.message ?? ''}
        onDismiss={clearErrorPopout}
      />

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
          {/* Online/Offline toggle — status conveyed by icon + text (not colour alone). */}
            <RoleTutorial role="rider" variant="icon" />
          <button
            onClick={toggleStatus}
            disabled={statusLoading || rider.status === 'BUSY'}
            role="switch"
            aria-checked={isOnline}
            aria-label={`You are ${rider.status === 'BUSY' ? 'busy' : isOnline ? 'online' : 'offline'}. Tap to go ${isOnline ? 'offline' : 'online'}.`}
            className="flex items-center gap-2 px-4 rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors active:scale-95"
            style={{
              minHeight: 48,
              background: isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isOnline ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: isOnline ? '#22C55E' : 'rgba(255,255,255,0.5)',
            }}
          >
            {statusLoading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="shrink-0 animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            ) : (
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: isOnline ? '#22C55E' : '#666', flexShrink: 0 }} />
            )}
            {rider.status === 'BUSY' ? 'Busy' : isOnline ? 'Online' : 'Offline'}
          </button>
            <NotificationBell />
            <LogoutButton />
          </div>
        </div>
      </div>

      {/* Wallet card */}
      {wallet && (
        <div className="lx-surface mx-4 mb-5 p-4 lx-enter">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/40 uppercase tracking-wide">Wallet</p>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{ background: TRUST_COLORS[wallet.trust_tier] ?? '#CD7F32', color: '#000' }}>
              {wallet.trust_tier}
            </span>
          </div>
          <p className="text-2xl font-bold text-white">
            <CountUp value={wallet.available_kobo ?? 0} format={(n) => formatPrice(Math.round(n))} />
          </p>
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

      <div className="mx-4 mb-5">
        <a href="/feed" className="block lx-surface lx-tap p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.22)' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="m10 9 5 3-5 3V9Z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Rider feed</p>
              <p className="text-xs text-white/45">See busy vendors, campus posts and delivery demand signals.</p>
            </div>
            <ChevronRight size={16} strokeWidth={2} className="text-white/30 shrink-0" />
          </div>
        </a>
      </div>

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
              {/* Pickup — where to collect the food. Most useful BEFORE pickup, so
                  it leads the card and carries a one-tap navigate-to-vendor link. */}
              {current.vendors && (current.vendors.address_text || current.vendors.landmark || (current.vendors.latitude != null && current.vendors.longitude != null)) && (
                <div className="rounded-xl p-3 mb-1" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)' }}>
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] uppercase tracking-wide font-semibold shrink-0 mt-0.5" style={{ color: '#F5A623' }}>Pickup</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white leading-snug">{current.vendors.shop_name}</p>
                      {current.vendors.address_text && <p className="text-xs text-white/60 leading-snug mt-0.5">{current.vendors.address_text}</p>}
                      {current.vendors.landmark && <p className="text-xs text-white/45 leading-snug mt-0.5">🚩 {current.vendors.landmark}</p>}
                    </div>
                  </div>
                  {directionsUrl(current.vendors.latitude, current.vendors.longitude) && (
                    <a
                      href={directionsUrl(current.vendors.latitude, current.vendors.longitude)!}
                      target="_blank" rel="noopener noreferrer"
                      className="mt-2.5 w-full inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold active:scale-[0.98] transition-transform"
                      style={{ background: '#F5A623', color: '#000', minHeight: 44 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                      Navigate to pickup
                    </a>
                  )}
                </div>
              )}
              <RiderAddress address={current.delivery_address} emphasis />
              <p className="text-[10px] text-white/30 uppercase tracking-wide pl-[23px] -mt-0.5">
                {current.delivery_type === 'DOOR' ? 'Door — bring it to the room' : 'Bike — meet at the lodge'}
              </p>
              {hasPin(current.delivery_latitude, current.delivery_longitude) && (
                <a
                  href={directionsUrl(current.delivery_latitude, current.delivery_longitude)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg text-xs font-semibold active:scale-[0.98] transition-transform px-3 py-2"
                  style={{ background: 'rgba(34,197,94,0.14)', color: '#22C55E', minHeight: 40 }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                  Navigate to drop-off
                </a>
              )}
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
                    aria-label="Message customer on WhatsApp"
                    className="ml-auto inline-flex items-center text-xs px-3.5 rounded-lg font-medium shrink-0 active:scale-95 transition-transform" style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366', minHeight: 44 }}
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
                    aria-label="Message vendor on WhatsApp"
                    className="ml-auto inline-flex items-center text-xs px-3.5 rounded-lg font-medium shrink-0 active:scale-95 transition-transform" style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366', minHeight: 44 }}
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
                className="lx-btn-amber w-full text-base font-bold active:scale-[0.98]"
                style={{ minHeight: 52 }}
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
                  className="w-full rounded-xl font-bold text-base disabled:opacity-50 active:scale-[0.98] transition-transform"
                  style={{ background: '#22C55E', color: '#000', minHeight: 52 }}
                >
                  {updatingStatus ? 'Updating…' : 'Mark as Delivered'}
                </button>
              )
            )}
            {current.status === 'DELIVERED' && (
              <button
                onClick={() => updateOrderStatus(current.id, 'COMPLETED')}
                disabled={updatingStatus}
                className="w-full rounded-xl font-bold text-base disabled:opacity-50 active:scale-[0.98] transition-transform"
                style={{ background: '#22C55E', color: '#000', minHeight: 52 }}
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
          <div className="lx-surface p-6 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            </div>
            <p className="font-semibold text-white/75">You&apos;re offline</p>
            <p className="text-sm text-white/40 mt-1">Go online to start catching orders.</p>
            <button
              onClick={toggleStatus}
              disabled={statusLoading}
              className="mt-4 px-7 rounded-xl font-bold text-base transition-transform active:scale-95 inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: '#22C55E', color: '#000', minHeight: 48 }}
            >
              {statusLoading && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>}
              Go Online
            </button>
          </div>
        )}

        {isOnline && available.length === 0 && !current && (
          <div className="lx-surface p-6 text-center">
            <div className="lx-icon-badge w-14 h-14 rounded-2xl mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-5l-2.5-6"/><path d="M12 6h3l2 5"/><path d="M6 11h7"/></svg>
            </div>
            <p className="font-semibold text-white/75">Engine&apos;s warm, no orders yet</p>
            <p className="text-sm text-white/40 mt-1">We&apos;ll buzz you the second one is ready.</p>
          </div>
        )}

        {isOnline && available.length > 0 && (
          <div className="space-y-3 lx-stagger">
            {available.map((order) => (
              <div key={order.id} className="lx-surface p-4">
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

                <div className="mb-3">
                  <RiderAddress address={order.delivery_address} />
                </div>

                <button
                  onClick={() => acceptOrder(order.id)}
                  disabled={acceptingId !== null || !!current}
                  className="lx-btn-amber w-full text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98]"
                  style={{ borderRadius: 12, minHeight: 52 }}
                >
                  {acceptingId === order.id ? (
                    <><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Accepting…</>
                  ) : current ? 'Finish current order first' : 'Accept Order'}
                </button>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Setup & account — below the work so orders stay up top. Riders have no
          working-hours schedule (like Chowdeck): availability is the Online/Offline
          toggle alone, nothing time-boxed. */}
      <div className="mx-4 mt-5"><LaunchCounter /></div>
      <div className="mx-4 mt-5"><KycPanel role="rider" /></div>

      {/* Account & settings consolidated on one page (profile, payout, security,
          sign out) — keeps this screen focused on deliveries. */}
      <div className="mx-4 mt-5 mb-2">
        <a href="/rider/settings" className="block lx-surface lx-tap p-4">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl grid place-items-center text-white/55 shrink-0" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lx-border)' }}>
              <Settings2 size={18} strokeWidth={1.75} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Account &amp; settings</p>
              <p className="text-xs text-white/45">Profile, payout, security &amp; sign out</p>
            </div>
            <ChevronRight size={16} strokeWidth={2} className="text-white/30 shrink-0" />
          </div>
        </a>
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
          <a href={arrivedWa} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full mb-2 rounded-lg text-sm font-semibold active:scale-[0.98] transition-transform" style={{ background: 'rgba(37,211,102,0.16)', color: '#25D366', minHeight: 44 }}>
            📲 Tell {firstName} you’ve arrived (WhatsApp)
          </a>
        )}
        <label className="block w-full text-center py-3 mb-2 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' }}>
          {uploading ? 'Uploading…' : order.delivery_photo_url ? '✓ Photo added — retake' : 'Add proof photo (optional)'}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)} disabled={uploading || busy} />
        </label>
        <button onClick={confirmGate} disabled={busy} className="w-full rounded-lg text-base font-bold disabled:opacity-50 active:scale-[0.98] transition-transform" style={{ background: '#22C55E', color: '#000', minHeight: 48 }}>
          {busy ? 'Confirming…' : 'Confirm drop'}
        </button>
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
      {/* Stacked (not side-by-side): the confirm button is full-width BELOW the input
          so it can never be clipped off the right edge of the card on a narrow phone. */}
      <input
        inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" maxLength={6} value={code}
        onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6)); setErr('') }}
        placeholder="ABC234"
        aria-label="6-character delivery code"
        className="lx-field w-full min-w-0 px-3 text-xl tracking-[0.4em] text-center font-semibold outline-none uppercase"
        style={{ minHeight: 52 }}
      />
      <button onClick={submitCode} disabled={busy || code.length !== 6} className="w-full mt-2 rounded-lg text-base font-bold disabled:opacity-50 active:scale-[0.98] transition-transform" style={{ background: '#22C55E', color: '#000', minHeight: 48 }}>
        {busy ? 'Confirming…' : 'Confirm delivery'}
      </button>
      {err && <p className="text-xs text-red-400 mt-1.5">{err}</p>}
    </div>
  )
}
