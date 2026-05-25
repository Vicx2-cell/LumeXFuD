'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { formatPrice } from '@/lib/money'
import type { OrderDetail } from './page'

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

export function OrderStatusClient({ order: initialOrder }: { order: OrderDetail }) {
  const router = useRouter()
  const [order, setOrder] = useState(initialOrder)
  const [showMessage, setShowMessage] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [sendingMsg, setSendingMsg] = useState(false)
  const [ratingData, setRatingData] = useState({ vendor_rating: 0, rider_rating: 0, feedback: '' })
  const [showRating, setShowRating] = useState(false)
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const msgEndRef = useRef<HTMLDivElement>(null)

  const statusIdx = getStatusIndex(order.status)
  const isActive = !['COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED'].includes(order.status)

  // Realtime subscription
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`order-${order.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${order.id}`,
      }, (payload) => {
        setOrder((prev) => ({ ...prev, ...(payload.new as Partial<OrderDetail>) }))
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [order.id])

  // Show rating prompt after completed
  useEffect(() => {
    if (order.status === 'COMPLETED' && !order.ratings?.length && !ratingSubmitted) {
      setShowRating(true)
    }
  }, [order.status, order.ratings, ratingSubmitted])

  // Load messages when chat opens
  useEffect(() => {
    if (!showMessage) return
    fetch(`/api/orders/${order.id}/messages`)
      .then((r) => r.json())
      .then((d: { messages?: MessageItem[] }) => {
        if (d.messages) setMessages(d.messages)
      })
      .catch(() => {})
  }, [showMessage, order.id])

  // Mark messages as read
  useEffect(() => {
    if (!showMessage) return
    fetch(`/api/orders/${order.id}/messages/read`, { method: 'PATCH' }).catch(() => {})
  }, [showMessage, order.id])

  // Scroll to latest message
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!message.trim()) return
    setSendingMsg(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), recipient_type: 'VENDOR' }),
      })
      const data = await res.json() as { message?: MessageItem }
      if (res.ok && data.message) {
        setMessages((prev) => [...prev, data.message!])
        setMessage('')
      }
    } finally {
      setSendingMsg(false)
    }
  }

  async function confirmDelivery() {
    await fetch(`/api/orders/${order.id}/confirm`, { method: 'POST' })
    setOrder((prev) => ({ ...prev, status: 'COMPLETED' }))
  }

  async function submitRating() {
    if (ratingData.vendor_rating === 0) return
    await fetch(`/api/orders/${order.id}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_rating: ratingData.vendor_rating,
        rider_rating: ratingData.rider_rating || undefined,
        vendor_review: ratingData.feedback || undefined,
      }),
    })
    setRatingSubmitted(true)
    setShowRating(false)
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

  return (
    <>
      {/* Messaging bottom sheet */}
      {showMessage && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowMessage(false) }}>
          <div className="mt-auto w-full max-w-lg mx-auto rounded-t-3xl flex flex-col"
            style={{ background: '#111113', maxHeight: '70vh' }}>
            <div className="flex items-center justify-between p-4 border-b border-white/8">
              <h3 className="font-semibold">Message {order.vendors?.shop_name ?? 'Vendor'}</h3>
              <button onClick={() => setShowMessage(false)} className="text-white/50 text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {messages.length === 0 && (
                <p className="text-center text-sm text-white/30 py-4">No messages yet</p>
              )}
              {messages.map((msg) => (
                <div key={msg.id}
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${msg.sender_type === 'CUSTOMER' ? 'ml-auto' : ''}`}
                  style={{
                    background: msg.sender_type === 'CUSTOMER' ? '#F5A623' : 'rgba(255,255,255,0.08)',
                    color: msg.sender_type === 'CUSTOMER' ? '#000' : '#fff',
                  }}
                >
                  <p>{msg.message}</p>
                  <p className={`text-[10px] mt-1 ${msg.sender_type === 'CUSTOMER' ? 'text-black/40' : 'text-white/30'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                    {msg.read_at && msg.sender_type === 'CUSTOMER' ? ' ✓✓' : ''}
                  </p>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            {isActive && (
              <div className="p-3 border-t border-white/8 flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 300))}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }}
                  placeholder="Type a message..."
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sendingMsg || !message.trim()}
                  className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40"
                  style={{ background: '#F5A623', color: '#000' }}
                >
                  →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rating modal */}
      {showRating && !ratingSubmitted && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-lg rounded-t-3xl p-6 space-y-4" style={{ background: '#111113' }}>
            <h3 className="font-semibold text-lg">Rate your order</h3>
            <div>
              <p className="text-sm text-white/60 mb-2">{order.vendors?.shop_name}</p>
              <StarRating value={ratingData.vendor_rating} onChange={(v) => setRatingData((d) => ({ ...d, vendor_rating: v }))} />
            </div>
            {order.rider_id && (
              <div>
                <p className="text-sm text-white/60 mb-2">Rider (optional)</p>
                <StarRating value={ratingData.rider_rating} onChange={(v) => setRatingData((d) => ({ ...d, rider_rating: v }))} />
              </div>
            )}
            <textarea
              value={ratingData.feedback}
              onChange={(e) => setRatingData((d) => ({ ...d, feedback: e.target.value.slice(0, 150) }))}
              placeholder="Any feedback? (optional)"
              rows={2}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
            />
            <button
              onClick={submitRating}
              disabled={ratingData.vendor_rating === 0}
              className="w-full rounded-xl py-3.5 font-semibold disabled:opacity-40"
              style={{ background: '#F5A623', color: '#000' }}
            >
              Submit rating
            </button>
            <button onClick={() => setShowRating(false)} className="w-full py-2 text-sm text-white/40">Maybe later</button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="sticky top-0 z-40 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/orders')} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
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

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {/* ETA */}
        {eta && isActive && (
          <div className="rounded-2xl p-4 text-center"
            style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }}>
            <p className="text-xs text-white/50 mb-1">Estimated arrival</p>
            <p className="text-3xl font-bold" style={{ color: '#F5A623' }}>{eta}</p>
          </div>
        )}

        {/* Status timeline */}
        <div className="rounded-2xl p-4 space-y-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
          {STATUS_STEPS.filter((s) => !['PENDING_PAYMENT'].includes(s.key)).map((step, i) => {
            const stepIdx = getStatusIndex(step.key)
            const done = statusIdx > stepIdx
            const current = statusIdx === stepIdx && step.key === order.status
            const future = stepIdx > statusIdx

            const ts = getTimestampForStatus(step.key, order)

            return (
              <div key={step.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${current && step.animated ? 'animate-pulse' : ''}`}
                    style={{
                      background: done ? '#22c55e' : current ? '#F5A623' : 'rgba(255,255,255,0.1)',
                    }}
                  >
                    {done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>}
                  </div>
                  {i < STATUS_STEPS.filter((s) => s.key !== 'PENDING_PAYMENT').length - 1 && (
                    <div className="w-0.5 h-5 mt-1" style={{ background: done ? '#22c55e' : 'rgba(255,255,255,0.08)' }} />
                  )}
                </div>
                <div className="flex-1 pb-1">
                  <p className={`text-sm font-medium ${future ? 'text-white/30' : ''}`}>{step.label}</p>
                  {ts && <p className="text-xs text-white/40 mt-0.5">{new Date(ts).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</p>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Rider card */}
        {order.riders && ['RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED'].includes(order.status) && (
          <div className="rounded-2xl p-4 flex items-center gap-4"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-xl">🏍️</div>
            <div className="flex-1">
              <p className="font-semibold">{order.riders.full_name}</p>
              <p className="text-xs text-white/40">Your rider</p>
            </div>
            <div className="flex gap-2">
              <a
                href={`tel:${order.riders.phone}`}
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                aria-label="Call rider"
              >
                📞
              </a>
              <a
                href={`https://wa.me/${order.riders.phone.replace('+', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                aria-label="WhatsApp rider"
              >
                💬
              </a>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {order.status === 'DELIVERED' && (
          <div className="space-y-3">
            <button
              onClick={confirmDelivery}
              className="w-full rounded-xl py-4 font-semibold"
              style={{ background: '#F5A623', color: '#000' }}
            >
              I received my food ✓
            </button>
            <button
              onClick={() => router.push(`/order/${order.order_number}/dispute`)}
              className="w-full py-3 text-sm rounded-xl"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              Report a problem
            </button>
          </div>
        )}

        {/* Order items */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-4 py-3 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white/70">Order items</h3>
          </div>
          {order.order_items.map((item, idx) => (
            <div key={item.id} className={`flex justify-between px-4 py-3 text-sm ${idx < order.order_items.length - 1 ? 'border-b border-white/5' : ''}`}>
              <span className="text-white/80">{item.name} × {item.quantity}</span>
              <span>{formatPrice(item.subtotal)}</span>
            </div>
          ))}
          <div className="px-4 py-3 border-t border-white/8 flex justify-between font-semibold">
            <span>Total</span>
            <span style={{ color: '#F5A623' }}>{formatPrice(order.total_amount)}</span>
          </div>
        </div>
      </div>

      {/* Floating message button */}
      {isActive && (
        <button
          onClick={() => setShowMessage(true)}
          className="fixed bottom-24 right-4 rounded-full px-4 py-3 font-medium text-sm flex items-center gap-2 shadow-lg"
          style={{ background: '#F5A623', color: '#000' }}
        >
          💬 Message
        </button>
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

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          className="text-3xl transition-transform active:scale-90"
          style={{ color: star <= value ? '#F5A623' : 'rgba(255,255,255,0.2)' }}
          aria-label={`${star} star`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

interface MessageItem {
  id: string
  sender_type: string
  recipient_type: string
  message: string
  read_at: string | null
  created_at: string
}
