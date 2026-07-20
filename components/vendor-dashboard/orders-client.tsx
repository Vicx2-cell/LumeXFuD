'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { waLink, telLink } from '@/lib/contact'
import { GlassSheen } from '@/components/fx'
import { Badge } from '@/components/ui/badge'
import { AlertBanner } from '@/components/ui/alert-banner'
import { LogoutButton } from '@/components/logout-button'
import { PageHeader } from '@/components/ui/page-header'
import { STATUS_COLOR, STATUS_LABEL, type VendorDashboardOrder, type VendorDashboardRecentOrder, type VendorDashboardSummary, type VendorDashboardVendor } from './helpers'
import { hasUsableLocation } from '@/lib/vendor-location'
import { MapPin } from 'lucide-react'

interface OrderItem {
  id: string
  name: string
  quantity: number
  price: number
  notes: string | null
  addons?: { name: string; price_kobo: number }[]
}

type LiveOrder = VendorDashboardOrder & { order_items: OrderItem[] }

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

export function VendorOrdersClient() {
  const router = useRouter()
  const [vendor, setVendor] = useState<VendorDashboardVendor | null>(null)
  const [summary, setSummary] = useState<VendorDashboardSummary | null>(null)
  const [orders, setOrders] = useState<LiveOrder[]>([])
  const [recent, setRecent] = useState<VendorDashboardRecentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusBusy, setStatusBusy] = useState(false)
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [errorBanner, setErrorBanner] = useState<{ title: string; message: string } | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const knownIds = useRef<Set<string>>(new Set())

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
    } catch {
      // Audio is optional.
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('New order - LumeX Fud', {
        body: 'A new order is waiting for you',
        icon: '/icons/icon-192-v2.png',
      })
    }
  }, [])

  const load = useCallback(async (isPoll = false) => {
    try {
      const res = await fetch('/api/vendor/orders')
      if (res.status === 401) {
        router.push('/auth')
        return
      }
      if (!res.ok) return

      const data = await res.json() as {
        vendor: VendorDashboardVendor
        orders: LiveOrder[]
        recent: VendorDashboardRecentOrder[]
        summary: VendorDashboardSummary
      }

      setVendor(data.vendor)
      setOrders(data.orders)
      setRecent(data.recent)
      setSummary(data.summary)

      if (isPoll) {
        const hasNew = data.orders.some((order) => order.status === 'PENDING' && !knownIds.current.has(order.id))
        if (hasNew) alert()
      }
      knownIds.current = new Set(data.orders.map((order) => order.id))
    } finally {
      setLoading(false)
    }
  }, [router, alert])

  useEffect(() => {
    load()
    try {
      if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
        const res = Notification.requestPermission()
        if (res && typeof (res as Promise<unknown>).catch === 'function') {
          ;(res as Promise<unknown>).catch(() => {})
        }
      }
    } catch {
      // Ignore unsupported notification flows.
    }
  }, [load])

  useEffect(() => {
    const id = setInterval(() => { void load(true) }, 12000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setVendor((current) => (current ? { ...current, status, paused_until: null } : current))
      setSummary((current) => (current ? { ...current, store_status: status } : current))
    } finally {
      setStatusBusy(false)
    }
  }

  const pause = async (minutes: '15' | '30' | '60') => {
    if (!vendor) return
    setPauseMenuOpen(false)
    setStatusBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      })
      const data = await res.json() as { paused_until: string }
      setVendor((current) => (current ? { ...current, status: 'BUSY', paused_until: data.paused_until } : current))
      setSummary((current) => (current ? { ...current, store_status: 'BUSY' } : current))
    } finally {
      setStatusBusy(false)
    }
  }

  const updateOrder = async (orderId: string, newStatus: string, commitment?: { estimated_prep_minutes: number; estimated_delivery_minutes: number; estimate_reason?: string }) => {
    const previousStatus = orders.find((order) => order.id === orderId)?.status
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...commitment }),
      })
      if (res.ok) {
        setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: newStatus } : order)))
        setSummary((current) => {
          if (!current) return current
          let nextPending = current.pending_orders
          if (previousStatus === 'PENDING' && newStatus !== 'PENDING') nextPending = Math.max(0, nextPending - 1)
          if (previousStatus !== 'PENDING' && newStatus === 'PENDING') nextPending += 1
          return { ...current, pending_orders: nextPending }
        })
        return
      }
      const data = await res.json().catch(() => ({})) as { error?: string }
      const message = data.error ?? 'Could not update the order. Refresh and try again.'
      showError('Could not update order', message)
      showToast(message)
    } catch {
      showError('Could not update order', 'Network error - check your connection and try again.')
      showToast('Network error - check your connection and try again.')
    }
  }

  const cancelOrder = async (orderId: string) => {
    const previousStatus = orders.find((order) => order.id === orderId)?.status
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
      if (res.ok) {
        setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: 'CANCELLED' } : order)))
        setSummary((current) => {
          if (!current) return current
          return {
            ...current,
            pending_orders: previousStatus === 'PENDING' ? Math.max(0, current.pending_orders - 1) : current.pending_orders,
          }
        })
        return
      }
      const data = await res.json().catch(() => ({})) as { error?: string }
      const message = data.error ?? 'Could not cancel the order. Refresh and try again.'
      showError('Could not cancel order', message)
      showToast(message)
    } catch {
      showError('Could not cancel order', 'Network error - check your connection and try again.')
      showToast('Network error - check your connection and try again.')
    }
  }

  const collectOrder = async (orderId: string, code: string): Promise<string | null> => {
    const res = await fetch(`/api/orders/${orderId}/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (res.ok) {
      setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: 'COMPLETED' } : order)))
      return null
    }
    const data = await res.json().catch(() => ({})) as { error?: string }
    return data.error ?? 'Could not collect this order.'
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

  const active = orders.filter((order) => ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY'].includes(order.status))
  const pendingCount = summary?.pending_orders ?? orders.filter((order) => order.status === 'PENDING').length
  const activeCount = active.length
  const isPaused = !!vendor?.paused_until && new Date(vendor.paused_until) > new Date()

  return (
    <div className="lx-page lx-console pb-10 overflow-hidden">
      <GlassSheen />
      <AlertBanner open={!!errorBanner} title={errorBanner?.title ?? ''} message={errorBanner?.message ?? ''} onDismiss={clearError} />
      {toast && (
        <div
          className="fixed left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-xl px-4 py-3 text-center text-sm font-medium lx-enter"
          style={{
            bottom: 'calc(1rem + env(safe-area-inset-bottom))',
            background: 'rgba(239,68,68,0.95)',
            color: '#fff',
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}
          role="alert"
        >
          {toast}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 pt-6">
        <PageHeader
          title="Orders"
          subtitle="Manage the live queue, update order status, and release completed pickup orders."
          badge="Vendor"
          actions={<LogoutButton />}
        />
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4 lx-enter">
        {vendor && !hasUsableLocation(vendor) && (
          <button
            onClick={() => router.push('/vendor-dashboard/store')}
            className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-[#F5A623]">
                <MapPin size={18} strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Add your store location</p>
                <p className="text-xs text-white/45">Drop a pin so customers and riders can find you faster.</p>
              </div>
            </div>
          </button>
        )}

        <section className="lx-surface p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Live status</p>
              <h2 className="text-xl font-semibold text-white">{vendor?.shop_name ?? 'Vendor'}</h2>
              <p className="mt-1 text-sm text-white/55">Stay on top of your queue and pause orders when needed.</p>
            </div>
            <Badge
              color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}
            >
              {vendor?.status ?? 'OPEN'}
            </Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-white/45">New</p>
              <p className="mt-1 text-lg font-semibold text-white lx-nums">{pendingCount}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-white/45">Active</p>
              <p className="mt-1 text-lg font-semibold text-white lx-nums">{activeCount}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-white/45">Today</p>
              <p className="mt-1 text-lg font-semibold text-white lx-nums">{summary?.orders_today ?? 0}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['OPEN', 'BUSY', 'CLOSED'] as const).map((status) => (
              <button
                key={status}
                type="button"
                disabled={statusBusy}
                onClick={() => void setStatus(status)}
                className="rounded-full border px-4 py-2 text-sm font-semibold transition disabled:opacity-50"
                style={{
                  background: vendor?.status === status ? '#F5A623' : 'rgba(255,255,255,0.04)',
                  color: vendor?.status === status ? '#000' : 'rgba(255,255,255,0.72)',
                  borderColor: vendor?.status === status ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.08)',
                }}
              >
                {status}
              </button>
            ))}

            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setPauseMenuOpen((value) => !value)}
                className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70"
              >
                Pause orders
              </button>
              {pauseMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-xl">
                  {(['15', '30', '60'] as const).map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => void pause(minutes)}
                      className="block w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/8"
                    >
                      {minutes} minutes
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isPaused && (
            <p className="text-xs text-amber-400">
              Paused until {new Date(vendor!.paused_until!).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          {summary && (
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-2 text-xs text-emerald-100/65">
              Your food sales today: <span className="font-semibold text-emerald-100">{formatPrice(summary.vendor_sales_today_kobo)}</span>
              <span className="ml-1 text-emerald-100/45">· platform and delivery fees excluded</span>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white/80">Active Orders</h2>
            {active.length > 0 && (
              <span className="rounded-full bg-[#F5A623] px-2 py-0.5 text-xs font-bold text-black">
                {active.length}
              </span>
            )}
          </div>

          {active.length === 0 ? (
            <div className="lx-surface py-12 text-center">
              <p className="text-sm font-medium text-white/75">All caught up</p>
              <p className="mt-1 text-xs text-white/40">New orders will appear here with an alert.</p>
            </div>
          ) : (
            <div className="space-y-2.5 lx-stagger">
              {active.map((order) => (
                <OrderCard key={order.id} order={order} onUpdate={updateOrder} onCancel={cancelOrder} onCollect={collectOrder} />
              ))}
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setRecentOpen((value) => !value)}
              aria-expanded={recentOpen}
              className="lx-surface flex w-full items-center justify-between rounded-2xl px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-white/70">
                Recent orders
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-white/50">{recent.length}</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-white/30 transition-transform" style={{ transform: recentOpen ? 'rotate(180deg)' : 'none' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: recentOpen ? '1fr' : '0fr' }}>
              <div className="overflow-hidden">
                <div className="mt-2 space-y-1.5">
                  {recent.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.03] px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{order.order_number}</p>
                        <p className="tabular-nums text-xs text-white/45">Your sale: {formatPrice(order.subtotal ?? 0)}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium" style={{ color: STATUS_COLOR[order.status] ?? 'rgba(255,255,255,0.4)' }}>
                        {STATUS_LABEL[order.status] ?? order.status}
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
  )
}

function OrderCard({
  order,
  onUpdate,
  onCancel,
  onCollect,
}: {
  order: LiveOrder
  onUpdate: (id: string, status: string, commitment?: { estimated_prep_minutes: number; estimated_delivery_minutes: number; estimate_reason?: string }) => Promise<void>
  onCancel: (id: string) => Promise<void>
  onCollect: (id: string, code: string) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [collectErr, setCollectErr] = useState('')
  const [prepEstimate, setPrepEstimate] = useState(12)
  const [deliveryEstimate, setDeliveryEstimate] = useState(order.delivery_type === 'PICKUP' ? 0 : 8)
  const [estimateReason, setEstimateReason] = useState('')
  const isPickup = order.delivery_type === 'PICKUP'
  const itemSummary = (order.order_items ?? []).map((item) => `${item.quantity}x ${item.name}`).join(' · ')

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (code.length !== 6) {
      setCollectErr('Enter the customer code.')
      return
    }
    setBusy(true)
    setCollectErr('')
    try {
      const err = await onCollect(order.id, code)
      if (err) setCollectErr(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`lx-surface relative overflow-hidden rounded-2xl lx-enter ${order.status === 'PENDING' ? 'lx-neworder' : ''}`}
      style={{
        border: `1px solid ${order.status === 'PENDING' ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: order.status === 'PENDING' ? '0 0 20px rgba(245,166,35,0.12), inset 0 1px 0 rgba(255,255,255,0.06)' : undefined,
      }}
    >
      <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-1.5" style={{ background: STATUS_COLOR[order.status] ?? 'rgba(255,255,255,0.2)' }} />

      <button onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-white">{order.order_number}</span>
            <span className="text-[11px] font-medium" style={{ color: STATUS_COLOR[order.status] }}>{STATUS_LABEL[order.status]}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-white/45">{itemSummary}</p>
          {order.promised_delivery_at && !['PENDING', 'COMPLETED', 'CANCELLED'].includes(order.status) && (
            <p className={`mt-1 text-[10px] font-medium ${order.delay_detected_at ? 'text-red-300' : 'text-amber-200/75'}`}>
              {order.delay_detected_at ? 'Speed alert active' : `Promised by ${new Date(order.promised_delivery_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular-nums text-sm font-semibold text-white">{formatPrice(order.subtotal ?? 0)}</p>
          <p className="text-[10px] text-white/30">Your food sale · {order.delivery_type}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/30 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="space-y-1 border-t border-white/6 px-5 pb-2 pt-2 lx-enter">
          <div className="mb-2 flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.025] px-3 py-2 text-xs">
            <span className="text-white/42">Food subtotal · paid on completion</span>
            <span className="font-semibold tabular-nums text-white/80">{formatPrice(order.subtotal ?? 0)}</span>
          </div>
          <p className="text-[11px] text-white/40">{order.delivery_type} - {order.delivery_address}</p>
          {order.order_items?.map((item) => (
            <div key={item.id} className="text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-white/90">{item.quantity}x {item.name}</span>
                {item.notes && <span className="text-xs text-amber-400">- {item.notes}</span>}
              </div>
              {item.addons && item.addons.length > 0 && (
                <p className="pl-4 text-xs text-white/40">+ {item.addons.map((addon) => addon.name).join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {isPickup && order.status === 'READY' && (
        <div className="border-t border-white/6 px-4 pb-3 pt-1 lx-enter">
          <div className="mb-2 rounded-lg bg-white/[0.04] p-2.5 text-xs">
            <p className="text-white/45">
              Order <span className="font-semibold text-white/80">#{order.order_number}</span>
              {order.customers?.name ? <> - for <span className="text-white/80">{order.customers.name.split(' ')[0]}</span></> : null}
            </p>
            {itemSummary && <p className="mt-1 text-white/70">{itemSummary}</p>}
          </div>
          {order.customers?.phone && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/45">Running late? Reach the customer:</span>
              <a
                href={waLink(order.customers.phone, `Hi${order.customers.name ? ` ${order.customers.name.split(' ')[0]}` : ''}, your LumeX order #${order.order_number} is ready.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg px-2 py-1 text-[11px] font-medium"
                style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366' }}
              >
                WhatsApp
              </a>
              <a
                href={telLink(order.customers.call_phone ?? order.customers.phone)}
                className="rounded-lg px-2 py-1 text-[11px] font-medium"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' }}
              >
                Call
              </a>
            </div>
          )}
          <p className="mb-2 text-xs text-white/50">Ask the customer for the 6-character pickup code.</p>
          <input
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6))
              setCollectErr('')
            }}
            placeholder="ABC234"
            className="lx-field w-full min-w-0 px-3 py-3 text-center text-lg font-semibold uppercase tracking-[0.4em] outline-none"
          />
          <button
            onClick={submitCode}
            disabled={busy || code.length !== 6}
            className="lx-tap mt-2 w-full min-h-[48px] rounded-lg py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--lx-green)', color: '#000' }}
          >
            {busy ? 'Collecting...' : 'Collect order'}
          </button>
          {collectErr && <p className="mt-1.5 text-xs text-red-400">{collectErr}</p>}
        </div>
      )}

      {order.status === 'PENDING' && (
        <div className="mx-3 mb-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-amber-200">Commit to a delivery time</p>
              <p className="mt-0.5 text-[11px] text-white/45">The platform target is 25 minutes from payment.</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${prepEstimate + deliveryEstimate <= 25 ? 'bg-green-400/15 text-green-300' : 'bg-red-400/15 text-red-300'}`}>
              {prepEstimate + deliveryEstimate} min total
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-white/55">Prep minutes
              <input type="number" inputMode="numeric" min={3} max={45} value={prepEstimate} onChange={(event) => setPrepEstimate(Math.min(45, Math.max(3, Number(event.target.value) || 3)))} className="lx-field mt-1 w-full px-3 py-2.5 text-sm text-white" />
            </label>
            <label className="text-[11px] text-white/55">{isPickup ? 'Pickup handoff' : 'Delivery minutes'}
              <input type="number" inputMode="numeric" min={0} max={30} disabled={isPickup} value={deliveryEstimate} onChange={(event) => setDeliveryEstimate(Math.min(30, Math.max(0, Number(event.target.value) || 0)))} className="lx-field mt-1 w-full px-3 py-2.5 text-sm text-white disabled:opacity-50" />
            </label>
          </div>
          {prepEstimate + deliveryEstimate > 30 && (
            <label className="mt-2 block text-[11px] text-red-200">Why will this take longer?
              <input value={estimateReason} onChange={(event) => setEstimateReason(event.target.value.slice(0, 160))} placeholder="e.g. large order; extra cooking time" className="lx-field mt-1 w-full px-3 py-2.5 text-sm text-white" />
            </label>
          )}
          {prepEstimate + deliveryEstimate > 25 && <p className="mt-2 text-[11px] text-amber-200/80">This commitment is above the 25-minute target and will count toward your speed record.</p>}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 px-3 pb-3 pt-1">
        {order.status === 'PENDING' && (
          <>
            <button
              onClick={() => void act(() => onCancel(order.id))}
              disabled={busy}
              className="lx-tap min-h-[44px] rounded-lg px-4 text-xs font-medium disabled:opacity-40"
              style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--lx-red)' }}
            >
              Decline
            </button>
            <button
              onClick={() => void act(() => onUpdate(order.id, 'VENDOR_ACCEPTED', { estimated_prep_minutes: prepEstimate, estimated_delivery_minutes: isPickup ? 0 : deliveryEstimate, ...(estimateReason.trim() ? { estimate_reason: estimateReason.trim() } : {}) }))}
              disabled={busy || (prepEstimate + deliveryEstimate > 30 && estimateReason.trim().length < 5)}
              className="lx-btn-amber lx-tap min-h-[44px] px-5 text-xs disabled:opacity-40"
            >
              {busy ? '...' : 'Accept'}
            </button>
          </>
        )}
        {order.status === 'VENDOR_ACCEPTED' && (
          <button
            onClick={() => void act(() => onUpdate(order.id, 'PREPARING'))}
            disabled={busy}
            className="lx-btn-amber lx-tap min-h-[44px] px-5 text-xs disabled:opacity-40"
          >
            {busy ? '...' : 'Start prep'}
          </button>
        )}
        {order.status === 'PREPARING' && (
          <button
            onClick={() => void act(() => onUpdate(order.id, 'READY'))}
            disabled={busy}
            className="lx-btn-amber lx-tap min-h-[44px] px-5 text-xs disabled:opacity-40"
          >
            {busy ? '...' : 'Mark ready'}
          </button>
        )}
        {order.status === 'READY' && order.delivery_type !== 'PICKUP' && (
          <button
            onClick={() => void act(() => onUpdate(order.id, 'COMPLETED'))}
            disabled={busy}
            className="lx-btn-amber lx-tap min-h-[44px] px-5 text-xs disabled:opacity-40"
          >
            {busy ? '...' : 'Complete'}
          </button>
        )}
      </div>
    </div>
  )
}
