'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { VerifiedBadge } from '@/components/verified-badge'
import type { OrderDetail } from './page'

const DISPUTE_REASONS = [
  'I never received my order',
  'Items were missing from my order',
  'Food was cold or spoiled',
  'I received the wrong order',
]

// Customers can report a problem up to 24h after delivery (mirrors the API).
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000

const STATUS_STEPS = [
  { key: 'PENDING_PAYMENT', label: 'Payment pending' },
  { key: 'PENDING', label: 'Order placed' },
  { key: 'VENDOR_ACCEPTED', label: 'Vendor confirmed' },
  { key: 'PREPARING', label: 'Preparing your food', animated: true },
  { key: 'READY', label: 'Ready for pickup' },
  { key: 'RIDER_ASSIGNED', label: 'Rider assigned' },
  { key: 'PICKED_UP', label: 'On the way' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'COMPLETED', label: 'Completed' },
]

const STATUS_ORDER = STATUS_STEPS.map((s) => s.key)

function getStatusIndex(status: string): number {
  const idx = STATUS_ORDER.indexOf(status)
  return idx === -1 ? 0 : idx
}

export function OrderStatusClient({
  order: initialOrder,
  canRate = false,
  alreadyRated = false,
  riderVerified = false,
}: {
  order: OrderDetail
  canRate?: boolean
  alreadyRated?: boolean
  riderVerified?: boolean
}) {
  const router = useRouter()
  const [order, setOrder] = useState(initialOrder)
  const [actionError, setActionError] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Vendor rating
  const [rated, setRated] = useState(alreadyRated)
  const [stars, setStars] = useState(0)
  const [hoverStars, setHoverStars] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [rateBusy, setRateBusy] = useState(false)
  const [rateError, setRateError] = useState('')
  // Rider rating (only shown when the order had a rider)
  const [riderStars, setRiderStars] = useState(0)
  const [riderHover, setRiderHover] = useState(0)
  const [riderReviewText, setRiderReviewText] = useState('')

  // Dispute form
  const [showDispute, setShowDispute] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeDesc, setDisputeDesc] = useState('')
  const [disputeBusy, setDisputeBusy] = useState(false)
  const [disputeError, setDisputeError] = useState('')
  const [conciergeReply, setConciergeReply] = useState('')

  const statusIdx = getStatusIndex(order.status)
  const isActive = !['COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED'].includes(order.status)

  // Keep local state in sync with refreshed server data (see polling below).
  useEffect(() => { setOrder(initialOrder) }, [initialOrder])

  // Live updates via polling. The anon Supabase browser client has no session
  // (this app uses a custom JWT in an httpOnly cookie), so Realtime delivers
  // nothing under the orders RLS policies. Refresh the server component on an
  // interval + on tab focus instead — this re-runs the page query and flows new
  // status (and the delivered/dispute actions) down as props.
  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => router.refresh(), 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isActive, router])

  async function confirmDelivery() {
    setActionError('')
    setConfirming(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/confirm`, { method: 'POST' })
      if (res.ok) {
        setOrder((prev) => ({ ...prev, status: 'COMPLETED' }))
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setActionError(d.error ?? 'Could not confirm your order. Please try again.')
      }
    } catch {
      setActionError('Network error. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  async function submitDispute() {
    const reason = disputeReason.trim()
    if (reason.length < 10) {
      setDisputeError('Please describe the problem in a bit more detail (at least 10 characters).')
      return
    }
    setDisputeBusy(true)
    setDisputeError('')
    try {
      const res = await fetch(`/api/orders/${order.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, description: disputeDesc.trim() || undefined }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string; concierge_reply?: string | null }
      if (res.ok) {
        if (d.concierge_reply) setConciergeReply(d.concierge_reply)
        setOrder((prev) => ({ ...prev, status: 'DISPUTED' }))
        setShowDispute(false)
      } else {
        setDisputeError(d.error ?? 'Could not submit your report. Please try again.')
      }
    } catch {
      setDisputeError('Network error. Please try again.')
    } finally {
      setDisputeBusy(false)
    }
  }

  async function submitRating() {
    if (stars < 1) {
      setRateError('Tap a star to rate first.')
      return
    }
    setRateBusy(true)
    setRateError('')
    try {
      const res = await fetch(`/api/orders/${order.id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stars,
          review: reviewText.trim() || undefined,
          rider_stars: riderStars > 0 ? riderStars : undefined,
          rider_review: riderStars > 0 ? (riderReviewText.trim() || undefined) : undefined,
        }),
      })
      if (res.ok) {
        setRated(true)
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        if (res.status === 409) setRated(true) // already reviewed — just show thanks
        else setRateError(d.error ?? 'Could not save your review. Please try again.')
      }
    } catch {
      setRateError('Network error. Please try again.')
    } finally {
      setRateBusy(false)
    }
  }

  // ETA calculation
  const getETA = (): string | null => {
    if (!order.vendors) return null
    if (['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED'].includes(order.status)) {
      const base = order.vendor_accepted_at ? new Date(order.vendor_accepted_at) : new Date()
      const eta = new Date(base.getTime() + (order.vendors.prep_time_minutes + 10) * 60_000)
      return eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
    }
    if (order.status === 'PICKED_UP' && order.picked_up_at) {
      const eta = new Date(new Date(order.picked_up_at).getTime() + 8 * 60_000)
      return eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
    }
    return null
  }

  const eta = getETA()

  // "Report a problem" stays available after the order auto-completes, up to 24h
  // after delivery — so a student who notices an issue later still has recourse.
  const canReportProblem =
    !!order.delivered_at &&
    new Date().getTime() - new Date(order.delivered_at).getTime() <= DISPUTE_WINDOW_MS

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 z-40 glass-thin px-4 py-3" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/orders')} className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90" style={{ background: 'rgba(255,255,255,0.08)' }} aria-label="Back to orders">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h1 className="font-semibold">#{order.order_number}</h1>
            <p className="text-xs text-white/40">{order.vendors?.shop_name}</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5 lx-enter">
        {/* Scheduled (prepaid pre-order) — waiting to be handed to the kitchen */}
        {order.status === 'SCHEDULED' && order.scheduled_for && (
          <div className="lx-card-amber-soft rounded-2xl p-5 text-center lx-scale-in">
            <p className="text-xs uppercase tracking-[0.18em] text-white/50 mb-1.5">🗓️ Scheduled · Paid ✓</p>
            <p className="lx-amber text-2xl font-bold tabular-nums">
              {new Date(order.scheduled_for).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-white/50 mt-2">We’ll send your order to the kitchen at this time — it arrives a bit after. Cancel any time before then for a full refund.</p>
          </div>
        )}

        {/* ETA */}
        {eta && isActive && (
          <div className="lx-card-amber-soft rounded-2xl p-5 text-center lx-scale-in" style={{ boxShadow: '0 0 40px rgba(245,166,35,0.08) inset' }}>
            <p className="text-xs uppercase tracking-[0.18em] text-white/50 mb-1.5">Estimated arrival</p>
            <p className="lx-amber text-4xl font-bold tabular-nums">{eta}</p>
          </div>
        )}

        {/* Status timeline */}
        <div className="glass-thin p-5">
          <div className="lx-stagger space-y-0">
            {STATUS_STEPS.filter((s) => !['PENDING_PAYMENT'].includes(s.key)).map((step, i, arr) => {
              const stepIdx = getStatusIndex(step.key)
              const done = statusIdx > stepIdx
              const current = statusIdx === stepIdx && step.key === order.status
              const future = stepIdx > statusIdx
              const isLast = i === arr.length - 1

              const ts = getTimestampForStatus(step.key, order)

              return (
                <div key={step.key} className="flex items-start gap-3.5">
                  <div className="flex flex-col items-center self-stretch">
                    <div className="relative shrink-0 mt-0.5">
                      {/* Pulsing ring on the current step */}
                      {current && (
                        <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(245,166,35,0.5)' }} aria-hidden="true" />
                      )}
                      <div
                        className="relative w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                        style={{
                          background: done ? '#22c55e' : current ? '#F5A623' : 'rgba(255,255,255,0.1)',
                          boxShadow: current ? '0 0 14px rgba(245,166,35,0.6)' : done ? '0 0 10px rgba(34,197,94,0.4)' : 'none',
                        }}
                      >
                        {done
                          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
                          : current ? <span className="w-2 h-2 rounded-full bg-black/70" /> : null}
                      </div>
                    </div>
                    {!isLast && (
                      <div className="w-0.5 flex-1 min-h-[20px] my-1 rounded-full transition-colors" style={{ background: done ? '#22c55e' : 'rgba(255,255,255,0.08)' }} />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className={`text-sm font-medium transition-colors ${future ? 'text-white/30' : current ? 'text-white' : 'text-white/85'}`}>
                      {step.label}
                      {current && step.animated && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse align-middle" />}
                    </p>
                    {ts && <p className="text-xs text-white/45 mt-0.5 tabular-nums">{new Date(ts).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Rider card */}
        {order.riders && ['RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED'].includes(order.status) && (
          <div className="glass-thin p-4 flex items-center gap-4 lx-scale-in">
            {order.riders.avatar_url ? (
              <div className="relative w-12 h-12 rounded-full overflow-hidden shrink-0" style={{ border: '2px solid rgba(245,166,35,0.4)' }}>
                <Image src={order.riders.avatar_url} alt="" fill className="object-cover" sizes="48px" />
              </div>
            ) : (
              <div className="lx-icon-badge w-12 h-12 rounded-full">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-5l-2.5-6"/><path d="M12 6h3l2 5"/><path d="M6 11h7"/></svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-white/40">Your rider</p>
              <div className="flex items-center gap-1.5">
                <p className="font-semibold truncate">{order.riders.full_name}</p>
                {riderVerified && <VerifiedBadge kind="rider" />}
              </div>
              <a href={`tel:${order.riders.phone}`} className="text-xs text-amber-400 tabular-nums hover:underline">{order.riders.phone}</a>
              {order.riders.opening_time && order.riders.closing_time && (
                <p className="text-[11px] text-white/40 mt-0.5 tabular-nums">🕒 Usually {order.riders.opening_time}–{order.riders.closing_time}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <a href={`tel:${order.riders.phone}`} className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }} aria-label="Call rider">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>
              </a>
              <a href={`sms:${order.riders.phone}`} className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }} aria-label="Text rider (SMS)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </a>
              <a href={`https://wa.me/${order.riders.phone.replace('+', '')}`} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }} aria-label="WhatsApp rider">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>
              </a>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {order.status === 'DELIVERED' && (
          <div className="space-y-3">
            <button onClick={confirmDelivery} disabled={confirming} className="lx-btn-amber w-full py-4 flex items-center justify-center gap-2 disabled:opacity-60">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              {confirming ? 'Confirming…' : 'I received my food'}
            </button>
            <button onClick={() => { setShowDispute(true); setDisputeError('') }} className="w-full py-3 text-sm rounded-xl transition-colors hover:bg-red-500/15" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              Report a problem
            </button>
            {actionError && (
              <p className="text-sm text-red-400 text-center">{actionError}</p>
            )}
          </div>
        )}

        {/* Report a problem stays reachable after auto-completion (within 24h) */}
        {order.status === 'COMPLETED' && canReportProblem && (
          <button
            onClick={() => { setShowDispute(true); setDisputeError('') }}
            className="w-full py-3 text-sm rounded-xl transition-colors hover:bg-red-500/15"
            style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.18)' }}
          >
            Something wrong with this order? Report a problem
          </button>
        )}

        {/* Dispute submitted confirmation — Lumi's empathetic reply when available */}
        {order.status === 'DISPUTED' && (
          conciergeReply ? (
            <div className="lx-card-amber-soft rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span aria-hidden="true">✨</span>
                <p className="lx-amber text-xs font-semibold tracking-wide">Lumi</p>
              </div>
              <p className="text-sm text-white/85 leading-relaxed">{conciergeReply}</p>
            </div>
          ) : (
            <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-sm font-semibold text-red-300">Problem reported</p>
              <p className="text-xs text-white/50 mt-1">Our team is reviewing it and will reach out. You&apos;ll get an update soon.</p>
            </div>
          )
        )}

        {/* Rate the vendor — appears once the order is completed, until reviewed */}
        {canRate && order.status === 'COMPLETED' && (
          rated ? (
            <div className="rounded-2xl p-4 text-center lx-scale-in" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
              <p className="text-sm font-semibold text-green-300">Thanks for your review</p>
              <p className="text-xs text-white/50 mt-1">It helps other students choose where to order.</p>
            </div>
          ) : (
            <div className="glass-thin p-5 lx-scale-in">
              <h3 className="font-semibold text-center">How was {order.vendors?.shop_name ?? 'your order'}?</h3>
              <p className="text-xs text-white/45 text-center mt-1">Your review is public and helps other students.</p>

              {/* Stars */}
              <div className="flex justify-center gap-2 mt-4" onMouseLeave={() => setHoverStars(0)}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = (hoverStars || stars) >= n
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStars(n)}
                      onMouseEnter={() => setHoverStars(n)}
                      className="transition-transform active:scale-90 hover:scale-110 p-1"
                      aria-label={`${n} star${n === 1 ? '' : 's'}`}
                      aria-pressed={stars === n}
                    >
                      <svg width="34" height="34" viewBox="0 0 24 24" fill={active ? '#F5A623' : 'none'} stroke={active ? '#F5A623' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  )
                })}
              </div>

              <textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value.slice(0, 500))}
                placeholder="Add a review (optional) — what did you think of the food?"
                rows={3}
                className="lx-field w-full px-3 py-2.5 text-sm outline-none resize-none mt-4"
              />

              {/* Rate the rider — only if this order had one. Optional. */}
              {order.rider_id && (
                <div className="mt-5 pt-4 border-t border-white/8">
                  <p className="text-sm font-medium text-center">Rate your rider{order.riders?.full_name ? ` · ${order.riders.full_name}` : ''}</p>
                  <p className="text-xs text-white/40 text-center mt-0.5">Optional — this stays private to the rider.</p>
                  <div className="flex justify-center gap-2 mt-3" onMouseLeave={() => setRiderHover(0)}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const active = (riderHover || riderStars) >= n
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRiderStars((cur) => (cur === n ? 0 : n))}
                          onMouseEnter={() => setRiderHover(n)}
                          className="transition-transform active:scale-90 hover:scale-110 p-1"
                          aria-label={`Rate rider ${n} star${n === 1 ? '' : 's'}`}
                          aria-pressed={riderStars === n}
                        >
                          <svg width="30" height="30" viewBox="0 0 24 24" fill={active ? '#F5A623' : 'none'} stroke={active ? '#F5A623' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      )
                    })}
                  </div>
                  {riderStars > 0 && (
                    <textarea
                      value={riderReviewText}
                      onChange={(e) => setRiderReviewText(e.target.value.slice(0, 500))}
                      placeholder="How was the delivery? (optional)"
                      rows={2}
                      className="lx-field w-full px-3 py-2.5 text-sm outline-none resize-none mt-3"
                    />
                  )}
                </div>
              )}

              {rateError && <p className="text-sm text-red-400 mt-2 text-center">{rateError}</p>}

              <button
                onClick={submitRating}
                disabled={rateBusy || stars < 1}
                className="lx-btn-amber w-full py-3.5 mt-3 disabled:opacity-50"
              >
                {rateBusy ? 'Submitting…' : 'Submit review'}
              </button>
            </div>
          )
        )}

        {/* Order items */}
        <div className="glass-thin overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white/70">Order items</h3>
          </div>
          {order.order_items.map((item, idx) => (
            <div key={item.id} className={`px-4 py-3 text-sm ${idx < order.order_items.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="flex justify-between">
                <span className="text-white/80">{item.name} × {item.quantity}</span>
                <span>{formatPrice(item.subtotal)}</span>
              </div>
              {item.addons && item.addons.length > 0 && (
                <p className="text-xs text-white/40 mt-0.5">+ {item.addons.map((a) => a.name).join(', ')}</p>
              )}
            </div>
          ))}
          <div className="px-4 py-3 border-t border-white/8 flex justify-between font-semibold">
            <span>Total</span>
            <span className="lx-amber">{formatPrice(order.total_amount)}</span>
          </div>
        </div>
      </div>

      {/* Dispute / report-a-problem modal */}
      {showDispute && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => !disputeBusy && setShowDispute(false)}>
          <div className="w-full max-w-lg rounded-2xl p-5 lx-scale-in" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Report a problem</h2>
              <button onClick={() => !disputeBusy && setShowDispute(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.08)' }} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <p className="text-xs text-white/45 mb-3">What went wrong? Pick one or describe it. You have up to 24 hours after delivery to report.</p>

            <div className="space-y-2 mb-3">
              {DISPUTE_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setDisputeReason(r)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors"
                  style={{
                    background: disputeReason === r ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${disputeReason === r ? '#F5A623' : 'rgba(255,255,255,0.08)'}`,
                    color: disputeReason === r ? '#F5A623' : 'rgba(255,255,255,0.8)',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            <textarea
              value={disputeDesc}
              onChange={(e) => setDisputeDesc(e.target.value.slice(0, 2000))}
              placeholder="Add any details (optional)…"
              rows={3}
              className="lx-field w-full px-3 py-2.5 text-sm outline-none resize-none mb-3"
            />

            {disputeError && <p className="text-sm text-red-400 mb-3">{disputeError}</p>}

            <button
              onClick={submitDispute}
              disabled={disputeBusy || disputeReason.trim().length < 10}
              className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
              style={{ background: '#ef4444', color: '#fff' }}
            >
              {disputeBusy ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function getTimestampForStatus(status: string, order: OrderDetail): string | null {
  const map: Record<string, string | null | undefined> = {
    PENDING: order.created_at,
    VENDOR_ACCEPTED: order.vendor_accepted_at,
    PREPARING: order.preparing_at,
    READY: order.ready_at,
    RIDER_ASSIGNED: order.rider_assigned_at,
    PICKED_UP: order.picked_up_at,
    DELIVERED: order.delivered_at,
    COMPLETED: order.completed_at,
    CANCELLED: order.cancelled_at,
  }
  return map[status] ?? null
}
