'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface ReviewRow {
  id: string
  stars: number
  review: string | null
  reviewer_name: string | null
  rider_stars: number | null
  rider_review: string | null
  created_at: string
  customer_id: string | null
  vendors: { shop_name: string } | { shop_name: string }[] | null
  riders: { full_name: string } | { full_name: string }[] | null
  customers: { name: string | null; phone: string } | { name: string | null; phone: string }[] | null
  orders: { order_number: string } | { order_number: string }[] | null
}

// PostgREST embeds a to-one relation as an object, but the typings allow an
// array — normalise to the single row either way.
function one<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width="14" height="14" viewBox="0 0 24 24" fill={value >= n ? '#F5A623' : 'none'} stroke={value >= n ? '#F5A623' : 'rgba(255,255,255,0.25)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  )
}

export default function AdminReviews() {
  const router = useRouter()
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [lowOnly, setLowOnly] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/reviews${lowOnly ? '?lowOnly=1' : ''}`)
    if (res.ok) {
      const d = await res.json() as { reviews: ReviewRow[] }
      setReviews(d.reviews)
    }
    setLoading(false)
  }, [lowOnly])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  async function remove(id: string) {
    setDeleting(id)
    const res = await fetch(`/api/admin/reviews/${id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({})) as { error?: string }
    if (res.ok) {
      setReviews((r) => r.filter((x) => x.id !== id))
      showToast('Review removed — vendor average recalculated')
    } else {
      showToast(d.error ?? 'Could not remove review')
    }
    setDeleting(null)
    setConfirmId(null)
  }

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: '#0A0A0B' }}>
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Reviews</h1>
            {!loading && (
              <p className="text-sm text-white/40">{reviews.length} {lowOnly ? 'low (1–2★)' : 'recent'} — newest first</p>
            )}
          </div>
          <button
            onClick={() => setLowOnly((v) => !v)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: lowOnly ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
              color: lowOnly ? '#EF4444' : 'rgba(255,255,255,0.6)',
              border: `1px solid ${lowOnly ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            {lowOnly ? 'Showing low ratings' : 'Low ratings only'}
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-3xl mb-3">💬</p>
            <p className="font-semibold text-white/60">{lowOnly ? 'No low ratings' : 'No reviews yet'}</p>
            <p className="text-sm text-white/30 mt-1">{lowOnly ? 'Nothing needs screening' : 'Reviews will appear here as customers post them'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => {
              const vendor = one(r.vendors)
              const rider = one(r.riders)
              const customer = one(r.customers)
              const order = one(r.orders)
              const low = r.stars <= 2 || (r.rider_stars != null && r.rider_stars <= 2)
              return (
                <div key={r.id} className="rounded-2xl p-4" style={{ background: '#111113', border: `1px solid ${low ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{vendor?.shop_name ?? 'Unknown vendor'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Stars value={r.stars} />
                        <span className="text-[11px] text-white/35">{relativeTime(r.created_at)}</span>
                      </div>
                    </div>
                    {order && <span className="text-[11px] text-white/35 shrink-0 tabular-nums">{order.order_number}</span>}
                  </div>

                  {r.review ? (
                    <p className="text-sm text-white/80 leading-relaxed mb-3">“{r.review}”</p>
                  ) : (
                    <p className="text-sm text-white/35 italic mb-3">No written vendor review — rating only</p>
                  )}

                  {/* Rider rating on the same order, if the customer left one */}
                  {r.rider_stars != null && (
                    <div className="mb-3 p-2.5 rounded-xl" style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.18)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] uppercase tracking-wide text-white/40">Rider · {rider?.full_name ?? 'Unknown'}</span>
                        <Stars value={r.rider_stars} />
                      </div>
                      {r.rider_review && <p className="text-sm text-white/70 mt-1.5 leading-relaxed">“{r.rider_review}”</p>}
                    </div>
                  )}

                  {/* The account behind the public "Anonymous" review */}
                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl mb-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <span className="text-[11px] uppercase tracking-wide text-white/35">Posted by</span>
                    {customer ? (
                      <a href={`tel:${customer.phone}`} className="text-sm text-amber-400 font-medium truncate">
                        {customer.name ?? 'Unnamed'} · {customer.phone}
                      </a>
                    ) : (
                      <span className="text-sm text-white/40">account deleted</span>
                    )}
                  </div>

                  {confirmId === r.id ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => remove(r.id)}
                        disabled={deleting === r.id}
                        className="py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.18)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.35)' }}
                      >
                        {deleting === r.id ? 'Removing…' : 'Confirm remove'}
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        disabled={deleting === r.id}
                        className="py-2.5 rounded-xl text-sm font-medium text-white/60 disabled:opacity-50"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(r.id)}
                      className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-red-500/10"
                      style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                      Remove review
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
