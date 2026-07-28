'use client'


import { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Heart, Search, UtensilsCrossed } from 'lucide-react'
import { PremiumImage } from '@/components/fx'
import type { VendorData } from './home/page'
import { vendorTrustBadges } from '@/lib/vendor-trust'
import { VerifiedBadge } from '@/components/verified-badge'
import { Pill } from '@/components/ui/pill'
import { campaignHref, getCampaignSessionId, trackCampaignEvent } from '@/lib/campaign-client'
import { storePath } from '@/lib/storefront'

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
  canManageFavorites = false,
}: {
  initialVendors: VendorData[]
  initialFavorites?: string[]
  initialLocations?: LocationRow[]
  initialSelectedZoneId?: string
  campaignId?: string
  canManageFavorites?: boolean
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
  const lastFetchedZoneRef = useRef(initialSelectedZoneId || (initialLocations[0]?.zone_id ?? ''))

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
    if (lastFetchedZoneRef.current === selectedZoneId) return
    lastFetchedZoneRef.current = selectedZoneId
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
    if (!canManageFavorites) return
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
    <div className="space-y-5">
      {locations.length > 0 && (
        <div>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <label className="block w-full sm:w-[340px]">
              <span className="sr-only">Select delivery zone</span>
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="lx-field w-full px-3 py-2.5 text-sm outline-none"
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
            <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
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
          placeholder="Search restaurants"
          className="lx-field min-h-13 w-full px-4 py-3 pl-11 text-sm outline-none"
        />
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--lx-text-faint)]" size={17} aria-hidden="true" />
      </div>

      {/* Category chips + Favourites filter (one-tap re-order shortcut) */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {canManageFavorites && favorites.size > 0 && (
          <Pill
            active={favOnly}
            onClick={() => setFavOnly((v) => !v)}
            className="shrink-0 px-4 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            <Heart size={14} fill={favOnly ? 'currentColor' : 'none'} aria-hidden="true" /> Favourites
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
        <div className="grid grid-cols-1 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-[124px]" style={{ borderRadius: 20 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="lx-surface py-16 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--lx-border)] bg-[var(--lx-surface-2)] text-[var(--color-amber)]" aria-hidden="true"><UtensilsCrossed size={22} /></span>
          <p className="text-sm font-semibold text-[var(--lx-text)]">No vendors match your search</p>
          <p className="mt-1 text-xs text-[var(--lx-text-muted)]">Try a different name or category.</p>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h1 className="text-base font-semibold text-[var(--lx-text)]">Restaurants</h1>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-white/55 tabular-nums">{filtered.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((vendor) => (
              <VendorCard
                key={vendor.id}
                vendor={vendor}
                favorited={favorites.has(vendor.id)}
                onToggleFavorite={toggleFavorite}
                campaignId={campaignId}
                canManageFavorites={canManageFavorites}
              />
            ))}
          </div>
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
  canManageFavorites,
}: {
  vendor: VendorData
  favorited: boolean
  onToggleFavorite: (id: string) => void
  campaignId?: string
  canManageFavorites: boolean
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
  const href = campaignHref(vendor.slug ? storePath(vendor.slug) : `/vendor/${vendor.id}`, campaignId)

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
      className="lx-tap glass-thin grid min-h-[142px] grid-cols-[118px_minmax(0,1fr)] overflow-hidden rounded-2xl sm:grid-cols-[132px_minmax(0,1fr)]"
      style={{ opacity: unavailable ? 0.72 : 1 }}>
      {/* Photo */}
      <div className="relative min-h-[142px] bg-white/5">
        {vendor.shop_photo_url ? (
          <PremiumImage
            src={vendor.shop_photo_url}
            alt={vendor.shop_name}
            fill
            sizes="132px"
            frameClassName="absolute inset-0"
            className="object-cover"
            style={unavailable ? { filter: 'grayscale(1)' } : undefined}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <UtensilsCrossed size={30} className="text-[var(--lx-text-faint)]" aria-hidden="true" />
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
          className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
          {statusLabel}
        </div>

        {/* Favourite heart — inside the Link, so stop the navigation on tap. */}
        {canManageFavorites && <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBeat(true); onToggleFavorite(vendor.id) }}
          aria-label={favorited ? `Remove ${vendor.shop_name} from favourites` : `Add ${vendor.shop_name} to favourites`}
          aria-pressed={favorited}
          className="absolute left-2 top-2 flex h-9 w-9 items-center justify-center rounded-full lx-tap"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={favorited ? '#F5A623' : 'none'} stroke={favorited ? '#F5A623' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className={beat ? 'lx-heartbeat' : undefined} onAnimationEnd={() => setBeat(false)}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>}

        {/* Vendor logo badge overlaid on the cover */}
        {vendor.logo_url && (
          <div className="absolute bottom-2 left-2 h-8 w-8 overflow-hidden rounded-lg" style={{ border: '2px solid rgba(255,255,255,0.25)', boxShadow: '0 4px 12px rgba(0,0,0,0.45)' }}>
            <Image src={vendor.logo_url} alt="" fill className="object-cover" sizes="32px" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-col justify-center p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-[15px] font-semibold leading-tight">{vendor.shop_name}</h2>
              {vendor.kyc_verified && <VerifiedBadge kind="vendor" />}
            </div>
            <p className="mt-1 truncate text-xs text-white/50">{vendor.category}</p>
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
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-white/40 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              {vendor.prep_time_minutes}–{vendor.prep_time_minutes + 10} min
            </span>
            {trust.slice(0, 1).map((b) => (
              <span key={b.label} className="lx-card-amber lx-amber inline-flex min-w-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px]">
                <span aria-hidden="true">{b.emoji}</span>{b.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
