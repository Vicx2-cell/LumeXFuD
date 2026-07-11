'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

type Flyer = {
  id: string
  image_url: string
  thumbnail_url: string
  headline: string
  subheadline: string
  cta: string
  campaign_type: string
  status: string
}

export default function VendorFlyerPage() {
  const params = useParams<{ id?: string }>()
  const router = useRouter()
  const [flyer, setFlyer] = useState<Flyer | null>(null)
  const [loading, setLoading] = useState(true)
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const res = await fetch(`/api/vendor/marketing/flyers/${id}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as { flyer?: Flyer }
        setFlyer(data.flyer ?? null)
        await fetch(`/api/vendor/marketing/flyers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'view' }) })
      }
      setLoading(false)
    })()
  }, [id])

  if (loading) {
    return <div className="lx-page flex min-h-screen items-center justify-center text-white/70">Loading flyer…</div>
  }

  if (!flyer) {
    return (
      <div className="lx-page min-h-screen p-6 text-white">
        <p className="text-lg font-semibold">Flyer not found</p>
        <button className="mt-4 rounded-full bg-[#F5A623] px-4 py-2 font-bold text-black" onClick={() => router.push('/vendor-dashboard?tab=marketing')}>
          Back to marketing
        </button>
      </div>
    )
  }

  return (
    <div className="lx-page min-h-screen bg-black p-4 text-white md:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/40">{flyer.campaign_type}</p>
            <h1 className="mt-1 text-2xl font-semibold">{flyer.headline}</h1>
            <p className="mt-1 text-sm text-white/50">{flyer.subheadline}</p>
          </div>
          <button className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold" onClick={() => router.push('/vendor-dashboard?tab=marketing')}>
            Close
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={flyer.thumbnail_url || flyer.image_url} alt={flyer.headline} className="w-full rounded-[28px] object-cover shadow-2xl" />
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-bold text-black" onClick={() => window.open(flyer.image_url, '_blank', 'noopener,noreferrer')}>
            Download
          </button>
          <button
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
            onClick={() => {
              if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                navigator.share({ title: flyer.headline, text: flyer.subheadline, url: window.location.href }).catch(() => {})
              }
            }}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  )
}
