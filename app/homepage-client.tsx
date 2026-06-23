'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { FOOD_BLUR } from '@/lib/blur'
import type { VendorData } from './home/page'
import { vendorTrustBadges } from '@/lib/vendor-trust'
import { VerifiedBadge } from '@/components/verified-badge'
import { Pill } from '@/components/ui/pill'

const CATEGORIES = ['All', 'Rice', 'Protein', 'Drinks', 'Snacks']

export function HomepageClient({ initialVendors }: { initialVendors: VendorData[] }) {
  // NOTE: realtime vendor-status subscription temporarily removed while isolating
  // the iOS "page couldn't load" crash on /home. Vendors are server-rendered
  // (revalidate 30), so the list still works without it.
  const [vendors] = useState<VendorData[]>(initialVendors)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')

  const filtered = useMemo(() => {
    const matches = vendors.filter((v) => {
      const matchSearch =
        !search ||
        v.shop_name.toLowerCase().includes(search.toLowerCase())
      const matchCategory =
        category === 'All' || v.category.toUpperCase() === category.toUpperCase()
      return matchSearch && matchCategory
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
  }, [vendors, search, category])

  return (
    <div className="space-y-4">
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

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
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
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-white/30 text-4xl mb-3">🍽️</p>
          <p className="text-white/50 text-sm">No vendors match your search.</p>
          <p className="text-white/30 text-xs mt-1">Try a different name or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
        </div>
      )}
    </div>
  )
}

function VendorCard({ vendor }: { vendor: VendorData }) {
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

  return (
    <Link href={`/vendor/${vendor.id}`} className="lx-tap glass-thin block rounded-2xl overflow-hidden"
      style={{ opacity: unavailable ? 0.72 : 1 }}>
      {/* Photo */}
      <div className="relative h-40 bg-white/5">
        {vendor.shop_photo_url ? (
          <Image
            src={vendor.shop_photo_url}
            alt={vendor.shop_name}
            fill
            className="object-cover"
            sizes="(max-width: 512px) 100vw, 512px"
            placeholder="blur"
            blurDataURL={FOOD_BLUR}
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
