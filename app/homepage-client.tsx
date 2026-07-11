'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { PremiumImage } from '@/components/fx'
import type { VendorData } from './home/page'
import { vendorTrustBadges } from '@/lib/vendor-trust'
import { VerifiedBadge } from '@/components/verified-badge'
import { Pill } from '@/components/ui/pill'
import { campaignHref, getCampaignSessionId, trackCampaignEvent } from '@/lib/campaign-client'

const CATEGORIES = ['All', 'Rice', 'Protein', 'Drinks', 'Snacks']

type LocationRow = {
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  zone_id: string
  zone_name: string
  uses_lodge_catalog: boolean
}

export function HomepageClient({
  initialVendors,
  initialFavorites = [],
  initialLocations = [],
  initialSelectedZoneId = '',
  campaignId = '',
}: {
  initialVendors: VendorData[]
  initialFavorites?: string[]
  initialLocations?: LocationRow[]
  initialSelectedZoneId?: string
  campaignId?: string
}) {
  // NOTE: realtime vendor-status subscription temporarily removed while isolating
  // the iOS "page couldn't load" crash on /home. Vendors are server-rendered
  // (revalidate 30), so the list still works without it.
  const [vendors, setVendors] = useState<VendorData[]>(initialVendors)
  const [locations] = useState<LocationRow[]>(initialLocations)
  const [selectedZoneId, setSelectedZoneId] = useState(initialSelectedZoneId || (initialLocations[0]?.zone_id ?? ''))
  const [loadingVendors, setLoadingVendors] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(initialFavorites))
  const [favOnly, setFavOnly] = useState(false)

  const zoneOptions = useMemo(() => locations, [locations])
  const selectedZone = useMemo(
    () => zoneOptions.find((row) => row.zone_id === selectedZoneId) ?? null,
    [zoneOptions, selectedZoneId],
  )

  useEffect(() => {
    if (zoneOptions.length === 0) {
      if (selectedZoneId) setSelectedZoneId('')
      return
    }
    if (!zoneOptions.some((row) => row.zone_id === selectedZoneId)) {
      setSelectedZoneId(zoneOptions[0].zone_id)
    }
  }, [zoneOptions, selectedZoneId])

  useEffect(() => {
    if (!selectedZoneId) return
    const controller = new AbortController()
    setLoadingVendors(true)
    fetch(`/api/vendors?zone_id=${encodeURIComponent(selectedZoneId)}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data: { vendors?: VendorData[] } | null) => {
        if (data?.vendors) setVendors(data.vendors)
      })
      .catch(() => {})
      .finally(() => setLoadingVendors(false))
    return () => controller.abort()
  }, [selectedZoneId])

  const toggleFavorite = (vendorId: string) => {
    const willFav = !favorites.has(vendorId)
    setFavorites((prev) => {
      const next = new Set(prev)
      if (willFav) next.add(vendorId); else next.delete(vendorId)
      return next
    })
    fetch('/api/customer/favorites', {
      method: willFav ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendorId }),
    }).catch(() => { /* optimistic — reverts on next load if it failed */ })
  }

  const filtered = useMemo(() => {
    const matches = vendors.filter((v) => {
      const matchSearch =
        !search ||
        v.shop_name.toLowerCase().includes(search.toLowerCase())
      const matchCategory =
        category === 'All' || v.category.toUpperCase() === category.toUpperCase()
      const matchFav = !favOnly || favorites.has(v.id)
      return matchSearch && matchCategory && matchFav
    })

    // Availability rank: OPEN first, then BUSY, then CLOSED/paused last. A stable
    // sort preserves the server's score order within each group, so good vendors
    // still rank high — they just never vanish when they close.
    const rank = (v: VendorData) => {
      const paused = v.paused_until && new Date(v.paused_until) > new Date()
      if (v.status === 'CLOSED' || paused) return 2
      if (v.status === 'BUSY') return 1
      return 0
    }
    return matches.slice().sort((a, b) => rank(a) - rank(b))
  }, [vendors, search, category, favOnly, favorites])

  return (
    <div className="space-y-4">
      {locations.length > 0 && (
        <div className="lx-surface px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-white/40">Delivery area</p>
              <p className="mt-0.5 text-xs text-white/50">Pick the zone you are in right now.</p>
            </div>
            <label className="block w-full sm:w-[340px]">
              <span className="sr-only">Select delivery zone</span>
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="lx-field w-full px-3.5 py-3 text-sm outline-none"
                style={{ colorScheme: 'dark' }}
                disabled={zoneOptions.length === 0}
              >
                <option value="">{zoneOptions.length > 0 ? 'Choose your area' : 'No delivery areas available'}</option>
                {zoneOptions.map((zone) => (
                  <option key={zone.zone_id} value={zone.zone_id}>
                    {zone.city_state} • {zone.city_name} • {zone.zone_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedZone && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
              <span className="font-medium text-white/80">{selectedZone.city_name}, {selectedZone.city_state}</span>
              <span className="mx-2 text-white/25">•</span>
              <span>{selectedZone.zone_name}</span>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendors..."
          className="lx-field w-full px-4 py-3 pl-10 text-sm outline-none"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      {/* Category chips + Favourites filter (one-tap re-order shortcut) */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {favorites.size > 0 && (
          <Pill
            active={favOnly}
            onClick={() => setFavOnly((v) => !v)}
            className="shrink-0 px-4 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            ❤️ Favourites
          </Pill>
        )}
        {CATEGORIES.map((cat) => (
          <Pill
            key={cat}
            active={category === cat}
            onClick={() => setCategory(cat)}
            className="shrink-0 px-4 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            {cat}
          </Pill>
        ))}
      </div>

      {/* Vendor list */}
      {loadingVendors ? (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-52" style={{ borderRadius: 20 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-white/30 text-4xl mb-3">🍽️</p>
          <p className="text-white/50 text-sm">No vendors match your search.</p>
          <p className="text-white/30 text-xs mt-1">Try a different name or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lx-stagger">
          {filtered.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              favorited={favorites.has(vendor.id)}
              onToggleFavorite={toggleFavorite}
              campaignId={campaignId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VendorCard({
  vendor,
  favorited,
  onToggleFavorite,
  campaignId,
}: {
  vendor: VendorData
  favorited: boolean
  onToggleFavorite: (id: string) => void
  campaignId?: string
}) {
  // One-shot heart "beat" on tap (not on mount) — fires only on user interaction.
  const [beat, setBeat] = useState(false)
  const sentImpression = useRef(false)
  const isPaused =
    vendor.paused_until && new Date(vendor.paused_until) > new Date()
  const isClosed = vendor.status === 'CLOSED'
  // Not taking orders right now — still shown, but clearly marked so customers
  // don't tap through expecting to order.
  const unavailable = isClosed || isPaused

  const statusColor =
    vendor.status === 'OPEN' ? '#22c55e' :
    vendor.status === 'BUSY' ? '#F5A623' : '#ef4444'

  const statusLabel = isPaused ? 'Paused' : vendor.status

  const trust = vendorTrustBadges(vendor)
  const href = campaignHref(`/vendor/${vendor.id}`, campaignId)

  useEffect(() => {
    if (!campaignId || sentImpression.current) return
    sentImpression.current = true
    trackCampaignEvent({
      campaignId,
      vendorId: vendor.id,
      eventType: 'marketplace_campaign_impression',
      source: 'marketplace',
      placement: 'home_marketplace_vendor_card',
      targetType: 'vendor',
      targetId: vendor.id,
      sessionId: getCampaignSessionId(),
      metadata: { vendor_name: vendor.shop_name },
    })
  }, [campaignId, vendor.id, vendor.shop_name])

  return (
    <Link
      href={href}
      onClick={() => {
        if (!campaignId) return
        trackCampaignEvent({
          campaignId,
          vendorId: vendor.id,
          eventType: 'marketplace_campaign_click',
          source: 'marketplace',
          placement: 'home_marketplace_vendor_card',
          targetType: 'vendor',
          targetId: vendor.id,
          sessionId: getCampaignSessionId(),
          metadata: { vendor_name: vendor.shop_name },
        })
      }}
      className="lx-tap glass-thin block rounded-2xl overflow-hidden"
      style={{ opacity: unavailable ? 0.72 : 1 }}>
      {/* Photo */}
      <div className="relative h-40 bg-white/5">
        {vendor.shop_photo_url ? (
          <PremiumImage
            src={vendor.shop_photo_url}
            alt={vendor.shop_name}
            fill
            sizes="(max-width: 512px) 100vw, 512px"
            frameClassName="absolute inset-0"
            className="object-cover"
            style={unavailable ? { filter: 'grayscale(1)' } : undefined}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl opacity-20">🍽️</span>
          </div>
        )}

        {/* Unavailable scrim + clear stamp so it's obvious at a glance */}
        {unavailable && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <span className="px-3.5 py-1.5 rounded-full text-sm font-bold tracking-wide"
              style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>
              {isClosed ? 'CLOSED' : 'PAUSED'}
            </span>
          </div>
        )}

        {/* Status badge */}
        <div
          className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
          {statusLabel}
        </div>

        {/* Favourite heart — inside the Link, so stop the navigation on tap. */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBeat(true); onToggleFavorite(vendor.id) }}
          aria-label={favorited ? `Remove ${vendor.shop_name} from favourites` : `Add ${vendor.shop_name} to favourites`}
          aria-pressed={favorited}
          className="absolute top-3 left-3 w-9 h-9 rounded-full flex items-center justify-center lx-tap"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={favorited ? '#F5A623' : 'none'} stroke={favorited ? '#F5A623' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className={beat ? 'lx-heartbeat' : undefined} onAnimationEnd={() => setBeat(false)}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Vendor logo badge overlaid on the cover */}
        {vendor.logo_url && (
          <div className="absolute bottom-2 left-2 w-10 h-10 rounded-xl overflow-hidden" style={{ border: '2px solid rgba(255,255,255,0.25)', boxShadow: '0 4px 12px rgba(0,0,0,0.45)' }}>
            <Image src={vendor.logo_url} alt="" fill className="object-cover" sizes="40px" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="font-semibold text-base leading-tight">{vendor.shop_name}</h2>
              {vendor.kyc_verified && <VerifiedBadge kind="vendor" />}
            </div>
            <p className="text-xs text-white/50 mt-0.5">{vendor.category}</p>
          </div>
          <div className="text-right shrink-0">
            {vendor.total_ratings >= 5 ? (
              <div className="lx-amber flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span className="text-sm font-medium">{vendor.avg_rating.toFixed(1)}</span>
                <span className="text-white/30 text-xs">({vendor.total_ratings})</span>
              </div>
            ) : (
              <span className="lx-card-amber lx-amber text-xs px-2 py-0.5 rounded-full">NEW</span>
            )}
          </div>
        </div>

        {unavailable ? (
          <p className="text-xs mt-2 font-medium" style={{ color: '#ef4444' }}>
            {isClosed ? 'Closed — not taking orders now' : 'Paused — back shortly'} · tap to view menu
          </p>
        ) : (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-white/40 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              {vendor.prep_time_minutes}–{vendor.prep_time_minutes + 10} min
            </span>
            {trust.map((b) => (
              <span key={b.label} className="lx-card-amber lx-amber text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                <span aria-hidden="true">{b.emoji}</span>{b.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
