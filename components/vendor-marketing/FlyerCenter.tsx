'use client'

import { useEffect, useRef, useState } from 'react'
type FlyerRow = {
  id: string
  flyer_event_id: string
  vendor_id: string
  event_type: string
  campaign_type: string
  source_entity_type: string
  source_entity_id: string
  template_id: string
  variation: number
  aspect_ratio: 'square' | 'status'
  headline: string
  subheadline: string
  cta: string
  image_url: string
  thumbnail_url: string
  status: string
  is_premium_campaign: boolean
  is_marketplace_campaign: boolean
  campaign_started_at: string | null
  campaign_ends_at: string | null
  viewed_at: string | null
  downloaded_at: string | null
  dismissed_at: string | null
  shared_at: string | null
  metrics?: Record<string, number>
  created_at: string
  updated_at: string
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function FlyerCenter({ vendorName, isPremium }: { vendorName: string; isPremium: boolean }) {
  const [flyers, setFlyers] = useState<FlyerRow[]>([])
  const [popup, setPopup] = useState<FlyerRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const openIdRef = useRef<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/vendor/marketing/flyers', { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json() as { flyers?: FlyerRow[]; popup?: FlyerRow | null }
    const nextFlyers = data.flyers ?? []
    setFlyers(nextFlyers)
    setPopup((current) => {
      if (current && nextFlyers.some((f) => f.id === current.id)) return current
      return data.popup ?? null
    })
    if (!openIdRef.current && data.popup) {
      openIdRef.current = data.popup.id
      setOpenId(data.popup.id)
    }
  }

  useEffect(() => {
    const kickoff = window.setTimeout(() => { void load() }, 0)
    const id = setInterval(() => { void load() }, 30000)
    return () => {
      clearTimeout(kickoff)
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    openIdRef.current = openId
  }, [openId])

  const track = async (flyer: FlyerRow, action: 'view' | 'share' | 'download' | 'dismiss' | 'regenerate') => {
    setBusyId(flyer.id)
    try {
      if (action === 'regenerate') {
        await fetch(`/api/vendor/marketing/flyers/${flyer.id}`, { method: 'POST' })
        await load()
        return
      }

      await fetch(`/api/vendor/marketing/flyers/${flyer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (action === 'share') {
        const text = `Check out this new LumeX Fud flyer from ${vendorName}: ${window.location.origin}/vendor/marketing/flyers/${flyer.id}`
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
        await fetch(`/api/vendor/marketing/flyers/${flyer.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss' }),
        })
      }
      if (action === 'download') {
        const link = document.createElement('a')
        link.href = flyer.image_url
        link.download = `lumex-flyer-${flyer.event_type}-${flyer.variation}.png`
        link.click()
        await fetch(`/api/vendor/marketing/flyers/${flyer.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss' }),
        })
      }
      if (action === 'dismiss') {
        setPopup((current) => (current?.id === flyer.id ? null : current))
        setOpenId((current) => (current === flyer.id ? null : current))
      }
      if (action === 'view') {
        setOpenId(flyer.id)
      }

      await load()
    } finally {
      setBusyId(null)
    }
  }

  const openFlyer = async (flyer: FlyerRow) => {
    await track(flyer, 'view')
    setOpenId(flyer.id)
  }

  const openFlyerFromPopup = async (flyer: FlyerRow) => {
    await track(flyer, 'dismiss')
    setOpenId(flyer.id)
  }

  const createFlyer = async () => {
    setGenerating(true)
    setMessage('')
    try {
      const res = await fetch('/api/vendor/marketing/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled.lunch_campaign',
          sourceEntityId: `manual-${Date.now()}`,
          payload: { source: 'vendor_dashboard' },
          premium: isPremium,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Could not create flyer')
      }
      setMessage('Flyer created. Pick one to download or share.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create flyer')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section className={`lx-surface rounded-2xl p-4 md:p-5 ${isPremium ? 'border border-amber-300/30 bg-gradient-to-br from-[#21170d] via-[#17120d] to-[#0c0a08]' : ''}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Marketing</p>
          <h2 className="text-lg font-semibold text-white">Flyers for WhatsApp and status</h2>
          <p className="mt-1 text-xs text-white/45">Create a clean promo image, then download or share it.</p>
        </div>
        <button
          type="button"
          onClick={() => void createFlyer()}
          disabled={generating}
          className="shrink-0 rounded-full bg-[#F5A623] px-4 py-2 text-xs font-black text-black disabled:opacity-60"
        >
          {generating ? 'Creating...' : 'Create flyer'}
        </button>
      </div>
      {message && <p className="mb-3 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2 text-xs text-white/65">{message}</p>}

      {flyers.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
          <p className="text-sm font-semibold text-white/75">No flyers yet</p>
          <p className="mt-1 text-xs text-white/40">Tap Create flyer to generate a lunch campaign from your menu and store details.</p>
          <button
            type="button"
            onClick={() => void createFlyer()}
            disabled={generating}
            className="mt-4 rounded-full bg-[#F5A623] px-5 py-2 text-sm font-black text-black disabled:opacity-60"
          >
            {generating ? 'Creating...' : 'Create first flyer'}
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {flyers.map((flyer) => (
            <article key={flyer.id} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
              <div className="grid gap-3 p-3 md:grid-cols-[110px_1fr]">
                <button type="button" onClick={() => void openFlyer(flyer)} className="overflow-hidden rounded-xl border border-white/8 bg-black/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={flyer.thumbnail_url || flyer.image_url} alt={`${flyer.event_type} flyer`} className="h-[110px] w-full object-cover" />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{flyer.campaign_type}</span>
                    <span className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] font-medium text-white/45">{flyer.status}</span>
                    <span className="text-[11px] text-white/30">{timeAgo(flyer.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{flyer.headline || flyer.event_type.replaceAll('.', ' · ')}</p>
                  <p className="mt-1 text-xs text-white/40">Variation {flyer.variation + 1} · {flyer.aspect_ratio}</p>
                  <p className="mt-1 text-[11px] text-white/35">
                    Views {flyer.metrics?.view ?? 0} · Shares {flyer.metrics?.share ?? 0} · Downloads {flyer.metrics?.download ?? 0}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void track(flyer, 'download')} disabled={busyId === flyer.id} className="rounded-full bg-[#F5A623] px-3 py-1.5 text-xs font-bold text-black disabled:opacity-60">
                      Download
                    </button>
                    <button type="button" onClick={() => void track(flyer, 'share')} disabled={busyId === flyer.id} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                      Share
                    </button>
                    <button type="button" onClick={() => void track(flyer, 'regenerate')} disabled={busyId === flyer.id} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                      Regenerate
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {popup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 md:items-center">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#12100d] shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={popup.thumbnail_url || popup.image_url} alt="Your flyer is ready" className="h-72 w-full object-cover" />
            <div className="p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Your flyer is ready</p>
              <h3 className="mt-1 text-xl font-semibold text-white">Share this update with your customers.</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void track(popup, 'download')} className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-bold text-black">
                  Download flyer
                </button>
                <button type="button" onClick={() => void track(popup, 'share')} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white">
                  Share to WhatsApp
                </button>
                <button type="button" onClick={() => void openFlyerFromPopup(popup)} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white">
                  View flyer
                </button>
                <button type="button" onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/vendor/marketing/flyers/${popup.id}`) }} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white">
                  Copy link
                </button>
                <button type="button" onClick={() => void track(popup, 'dismiss')} className="rounded-full bg-transparent px-4 py-2 text-sm font-semibold text-white/60">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {openId && flyers.some((f) => f.id === openId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpenId(null)}>
          <div className="max-h-[90vh] w-full max-w-[420px] overflow-hidden rounded-[24px] border border-white/10 bg-[#120f0c]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flyers.find((f) => f.id === openId)?.image_url ?? ''} alt="Flyer preview" className="h-auto w-full object-cover" />
          </div>
        </div>
      )}
    </section>
  )
}
