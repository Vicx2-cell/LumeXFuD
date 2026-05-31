'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { formatPrice } from '@/lib/money'

interface OrderItem { id: string; name: string; quantity: number; price: number; notes: string | null }
interface VendorOrder {
  id: string
  order_number: string
  status: string
  delivery_type: 'BIKE' | 'DOOR'
  delivery_address: string
  total_amount: number
  created_at: string
  order_items: OrderItem[]
}
interface VendorInfo {
  id: string
  shop_name: string
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  prep_time_minutes: number
}

const ACTIVE = ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY']

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'New Order', VENDOR_ACCEPTED: 'Confirmed',
  PREPARING: 'Preparing', READY: 'Ready for Rider',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#F5A623', VENDOR_ACCEPTED: '#60a5fa',
  PREPARING: '#a78bfa', READY: '#4ade80',
  COMPLETED: 'rgba(255,255,255,0.3)', CANCELLED: '#f87171',
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
  const audioCtx = useRef<AudioContext | null>(null)
  const knownIds = useRef<Set<string>>(new Set())

  const alert = useCallback(() => {
    try {
      const ctx = audioCtx.current ?? new AudioContext()
      audioCtx.current = ctx
      beep(ctx)
    } catch {}
    if (Notification.permission === 'granted') {
      new Notification('New Order — LumeX Fud', {
        body: 'A new order is waiting for you',
        icon: '/icon-192.png',
      })
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vendor/orders')
      if (res.status === 401) { router.push('/auth'); return }
      if (!res.ok) return
      const data = await res.json() as { vendor: VendorInfo; orders: VendorOrder[]; recent: typeof recent }
      setVendor(data.vendor)
      setOrders(data.orders)
      setRecent(data.recent)
      data.orders.forEach((o) => knownIds.current.add(o.id))
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
    Notification.requestPermission().catch(() => {})
  }, [load])

  useEffect(() => {
    if (!vendor?.id) return
    const supabase = createSupabaseBrowserClient()
    const ch = supabase
      .channel(`vendor-${vendor.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `vendor_id=eq.${vendor.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const o = payload.new as VendorOrder
          if (!knownIds.current.has(o.id)) {
            knownIds.current.add(o.id)
            setOrders((prev) => [o, ...prev])
            alert()
          }
        } else if (payload.eventType === 'UPDATE') {
          setOrders((prev) => prev.map((o) => o.id === payload.new.id ? { ...o, ...(payload.new as Partial<VendorOrder>) } : o))
        }
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [vendor?.id, alert])

  const setStatus = async (status: 'OPEN' | 'BUSY' | 'CLOSED') => {
    if (!vendor) return
    setStatusBusy(true)
    try {
      await fetch(`/api/vendors/${vendor.id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setVendor((v) => v ? { ...v, status } : v)
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

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#0A0A0B' }}>
        <div className="space-y-3 w-full max-w-lg px-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />)}
        </div>
      </div>
    )
  }

  const active = orders.filter((o) => ACTIVE.includes(o.status))

  return (
    <div className="min-h-dvh pb-10" style={{ background: '#0A0A0B' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-white/8" style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-widest">Vendor</p>
            <p className="font-semibold text-white leading-tight">{vendor?.shop_name ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/vendor-dashboard/earnings')}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}
            >
              💰 Earnings
            </button>
            <span
              className="text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{
                background: vendor?.status === 'OPEN' ? 'rgba(74,222,128,0.15)' : vendor?.status === 'BUSY' ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.08)',
                color: vendor?.status === 'OPEN' ? '#4ade80' : vendor?.status === 'BUSY' ? '#F5A623' : 'rgba(255,255,255,0.4)',
                border: '1px solid currentColor',
              }}
            >
              {vendor?.status}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        {/* Status Controls */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
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
            <div className="rounded-2xl border border-white/8 py-10 text-center">
              <p className="text-3xl mb-2">🍽️</p>
              <p className="text-sm text-white/30">No active orders</p>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((order) => (
                <OrderCard key={order.id} order={order} onUpdate={updateOrder} onCancel={cancelOrder} />
              ))}
            </div>
          )}
        </section>

        {/* Recent */}
        {recent.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-white/30 mb-3">Recent</h2>
            <div className="space-y-2">
              {recent.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div>
                    <p className="text-sm font-medium text-white">{o.order_number}</p>
                    <p className="text-xs text-white/30">{formatPrice(o.total_amount)}</p>
                  </div>
                  <span className="text-xs font-medium" style={{ color: STATUS_COLOR[o.status] ?? 'rgba(255,255,255,0.4)' }}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function OrderCard({
  order,
  onUpdate,
  onCancel,
}: {
  order: VendorOrder
  onUpdate: (id: string, status: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${order.status === 'PENDING' ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: order.status === 'PENDING' ? '0 0 20px rgba(245,166,35,0.08)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="text-xs text-white/40 mt-0.5">{order.delivery_type} · {order.delivery_address.slice(0, 45)}</p>
        </div>
        <span
          className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: `${STATUS_COLOR[order.status]}20`, color: STATUS_COLOR[order.status] }}
        >
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <div className="space-y-1 border-t border-white/6 pt-3">
        {order.order_items?.map((item) => (
          <div key={item.id} className="flex items-center gap-1.5 text-sm">
            <span className="text-white/90">{item.quantity}× {item.name}</span>
            {item.notes && <span className="text-xs text-amber-400">· {item.notes}</span>}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-sm font-semibold text-white">{formatPrice(order.total_amount)}</p>
        <div className="flex gap-2">
          {order.status === 'PENDING' && (
            <>
              <button
                onClick={() => act(() => onCancel(order.id))}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', minHeight: 40 }}
              >
                Decline
              </button>
              <button
                onClick={() => act(() => onUpdate(order.id, 'VENDOR_ACCEPTED'))}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: '#F5A623', color: '#000', minHeight: 40 }}
              >
                Accept
              </button>
            </>
          )}
          {order.status === 'VENDOR_ACCEPTED' && (
            <button
              onClick={() => act(() => onUpdate(order.id, 'PREPARING'))}
              disabled={busy}
              className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: '#F5A623', color: '#000', minHeight: 40 }}
            >
              Start Preparing
            </button>
          )}
          {order.status === 'PREPARING' && (
            <button
              onClick={() => act(() => onUpdate(order.id, 'READY'))}
              disabled={busy}
              className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: '#4ade80', color: '#000', minHeight: 40 }}
            >
              Mark Ready
            </button>
          )}
          {order.status === 'READY' && (
            <span className="px-3 py-2 text-sm text-white/30">Waiting for rider…</span>
          )}
        </div>
      </div>
    </div>
  )
}
