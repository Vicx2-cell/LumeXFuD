'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { formatPrice } from '@/lib/money'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { BackButton } from '@/components/back-button'

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
  const supabase = createSupabaseBrowserClient()

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const fetchData = useCallback(async () => {
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
        if (Notification.permission === 'granted') {
          new Notification('New order available!', {
            body: `${incoming[0].vendors?.shop_name ?? 'Order'} — ${formatPrice(incoming[0].rider_delivery_cut)}`,
            icon: '/icon-192.png',
          })
        }
      }
      prevAvailableIds.current = newIds
    }
    if (walletRes.ok) {
      const w = await walletRes.json() as WalletBalance
      setWallet(w)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [fetchData])

  useEffect(() => {
    if (!rider) return
    const channel = supabase
      .channel(`rider-${rider.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `status=eq.READY` },
        () => { fetchData() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `rider_id=eq.${rider.id}` },
        () => { fetchData() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [rider, supabase, fetchData])

  async function toggleStatus() {
    if (!rider) return
    const next: RiderStatus = rider.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE'
    setStatusLoading(true)
    const res = await fetch(`/api/riders/${rider.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (res.ok) {
      setRider((r) => r ? { ...r, status: next } : r)
      showToast(`You are now ${next.toLowerCase()}`)
    } else {
      const d = await res.json() as { error?: string }
      showToast(d.error ?? 'Failed to update status')
    }
    setStatusLoading(false)
  }

  async function acceptOrder(orderId: string) {
    if (!rider) return
    setAcceptingId(orderId)
    const res = await fetch(`/api/riders/${rider.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    })
    const d = await res.json() as { error?: string; order_number?: string }
    if (res.ok) {
      showToast(`Order ${d.order_number} accepted!`)
      await fetchData()
    } else {
      showToast(d.error ?? 'Order no longer available')
      await fetchData()
    }
    setAcceptingId(null)
  }

  async function updateOrderStatus(orderId: string, status: string) {
    setUpdatingStatus(true)
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      showToast(status === 'PICKED_UP' ? 'Marked as picked up' : 'Marked as delivered')
      await fetchData()
    } else {
      const d = await res.json() as { error?: string }
      showToast(d.error ?? 'Failed to update order')
    }
    setUpdatingStatus(false)
  }

  if (loading) {
    return (
      <div className="min-h-dvh px-4 py-6 space-y-4" style={{ background: '#0A0A0B' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
        ))}
      </div>
    )
  }

  if (!rider) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#0A0A0B' }}>
        <p className="text-white/40">Rider account not found</p>
      </div>
    )
  }

  const isOnline = rider.status === 'ONLINE' || rider.status === 'BUSY'

  return (
    <main className="min-h-dvh pb-10" style={{ background: '#0A0A0B' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg"
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
              <p className="text-sm text-white/40 mt-0.5">
                {rider.total_deliveries} deliveries · ⭐ {rider.avg_rating?.toFixed(1) ?? '—'}
              </p>
            </div>
          </div>
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
        </div>
      </div>

      {/* Wallet card */}
      {wallet && (
        <div className="mx-4 mb-5 rounded-2xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
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
              {wallet.held_balance} held (releases after 24h)
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
          <div className="rounded-2xl p-4" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.25)' }}>
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

            <div className="space-y-1.5 mb-4">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <span>📍</span>
                <span className="truncate">{current.delivery_address}</span>
              </div>
              {current.customers && (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <span>👤</span>
                  <a href={`tel:${current.customers.phone}`} className="text-amber-400">{current.customers.name ?? current.customers.phone}</a>
                </div>
              )}
              {current.vendors?.phone && (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <span>🏪</span>
                  <a href={`tel:${current.vendors.phone}`} className="text-amber-400">{current.vendors.phone}</a>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <span>💰</span>
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
          </div>
        </div>
      )}

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
          <div className="rounded-2xl p-5 text-center" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-2xl mb-2">😴</p>
            <p className="font-semibold text-white/70">You are offline</p>
            <p className="text-sm text-white/30 mt-1">Go online to see available orders</p>
            <button
              onClick={toggleStatus}
              disabled={statusLoading}
              className="mt-4 px-6 py-2.5 rounded-xl font-semibold text-sm"
              style={{ background: '#22C55E', color: '#000' }}
            >
              Go Online
            </button>
          </div>
        )}

        {isOnline && available.length === 0 && !current && (
          <div className="rounded-2xl p-5 text-center" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-2xl mb-2">🏍️</p>
            <p className="font-semibold text-white/70">No orders right now</p>
            <p className="text-sm text-white/30 mt-1">You'll be notified when an order is ready</p>
          </div>
        )}

        {isOnline && available.length > 0 && (
          <div className="space-y-3">
            {available.map((order) => (
              <div key={order.id} className="rounded-2xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-white">{order.order_number}</p>
                    <p className="text-xs text-white/50 mt-0.5">{order.vendors?.shop_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-400">{formatPrice(order.rider_delivery_cut)}</p>
                    <p className="text-xs text-white/40 mt-0.5">{order.delivery_type === 'BIKE' ? '🏍️ Bike' : '🚪 Door'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-white/50 mb-3">
                  <span>📍</span>
                  <span className="truncate">{order.delivery_address}</span>
                </div>

                <button
                  onClick={() => acceptOrder(order.id)}
                  disabled={acceptingId !== null || !!current}
                  className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-40"
                  style={{ background: '#F5A623', color: '#000' }}
                >
                  {acceptingId === order.id ? 'Accepting…' : current ? 'Finish current order first' : 'Accept Order'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
