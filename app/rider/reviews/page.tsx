'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ReviewRow {
  id: string
  rider_stars: number
  rider_review: string | null
  created_at: string
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" fill={value >= n ? '#F5A623' : 'none'} stroke={value >= n ? '#F5A623' : 'rgba(255,255,255,0.25)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  )
}

export default function RiderReviews() {
  const router = useRouter()
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [avg, setAvg] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/rider/reviews')
      if (res.status === 401) { router.push('/auth'); return }
      if (res.ok) {
        const d = await res.json() as { reviews: ReviewRow[]; avg_rating: number; total_ratings: number }
        setReviews(d.reviews)
        setAvg(Number(d.avg_rating) || 0)
        setTotal(d.total_ratings || 0)
      }
      setLoading(false)
    })()
  }, [router])

  const written = reviews.filter((r) => r.rider_review)

  return (
    <div className="lx-page overflow-hidden" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
      <div className="sticky top-0 z-40 glass-thin" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="Go back" className="w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-lg text-white/60 active:scale-90 transition-transform" style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <h1 className="font-semibold text-white">Your reviews</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4 lx-enter">
        <div className="glass rounded-3xl p-7 text-center relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-x-0 -top-12 h-32 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, rgba(245,166,35,0.28), transparent 70%)' }} />
          {total > 0 ? (
            <div className="relative">
              <p className="lx-display lx-foodie-text text-6xl font-bold leading-none tracking-tight">{avg.toFixed(1)}</p>
              <div className="flex justify-center mt-3"><Stars value={Math.round(avg)} size={22} /></div>
              <p className="text-xs text-white/50 mt-3">{total} rating{total === 1 ? '' : 's'} · {written.length} written</p>
            </div>
          ) : (
            <div className="relative">
              <p className="text-sm font-medium text-white/70">No ratings yet</p>
              <p className="text-xs text-white/40 mt-1">Customers can rate you after you deliver their order.</p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl lx-skeleton" />)}
          </div>
        ) : reviews.length > 0 && (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="glass rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <span className="lx-icon-badge w-9 h-9 rounded-full shrink-0">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white/80">Anonymous</span>
                      <span className="text-[11px] text-white/35 shrink-0">{relativeDay(r.created_at)}</span>
                    </div>
                    <div className="mt-0.5"><Stars value={r.rider_stars} size={13} /></div>
                  </div>
                </div>
                {r.rider_review && <p className="text-sm text-white/80 mt-3 leading-relaxed">{r.rider_review}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
