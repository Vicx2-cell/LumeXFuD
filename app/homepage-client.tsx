'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { VendorData } from './page'

const CATEGORIES = ['All', 'Rice', 'Protein', 'Drinks', 'Snacks']

export function HomepageClient({ initialVendors }: { initialVendors: VendorData[] }) {
  const [vendors, setVendors] = useState<VendorData[]>(initialVendors)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')

  // Realtime: subscribe to vendors table for live status updates
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel('vendors-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vendors' }, (payload) => {
        setVendors((prev) =>
          prev.map((v) =>
            v.id === payload.new.id ? { ...v, ...(payload.new as Partial<VendorData>) } : v
          )
        )
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  const filtered = useMemo(() => {
    return vendors.filter((v) => {
      const matchSearch =
        !search ||
        v.shop_name.toLowerCase().includes(search.toLowerCase())
      const matchCategory =
        category === 'All' || v.category.toUpperCase() === category.toUpperCase()
      return matchSearch && matchCategory
    })
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
          className="w-full rounded-xl px-4 py-3 pl-10 text-sm outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className="shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors"
            style={{
              background: category === cat ? '#F5A623' : 'rgba(255,255,255,0.07)',
              color: category === cat ? '#000' : 'rgba(255,255,255,0.7)',
              minHeight: 44,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Vendor list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-white/30 text-4xl mb-3">🍽️</p>
          <p className="text-white/50 text-sm">No vendors open right now.</p>
          <p className="text-white/30 text-xs mt-1">Check back between 7am – 10pm.</p>
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

  const statusColor =
    vendor.status === 'OPEN' ? '#22c55e' :
    vendor.status === 'BUSY' ? '#F5A623' : '#ef4444'

  const statusLabel = isPaused ? 'Paused' : vendor.status

  return (
    <Link href={`/vendor/${vendor.id}`} className="block rounded-2xl overflow-hidden"
      style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
      {/* Photo */}
      <div className="relative h-40 bg-white/5">
        {vendor.shop_photo_url ? (
          <Image
            src={vendor.shop_photo_url}
            alt={vendor.shop_name}
            fill
            className="object-cover"
            sizes="(max-width: 512px) 100vw, 512px"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl opacity-20">🍽️</span>
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
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-base leading-tight">{vendor.shop_name}</h2>
            <p className="text-xs text-white/50 mt-0.5">{vendor.category}</p>
          </div>
          <div className="text-right shrink-0">
            {vendor.total_ratings >= 5 ? (
              <div className="flex items-center gap-1 text-[#F5A623]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span className="text-sm font-medium">{vendor.avg_rating.toFixed(1)}</span>
                <span className="text-white/30 text-xs">({vendor.total_ratings})</span>
              </div>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>NEW</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs text-white/40 flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
            {vendor.prep_time_minutes}–{vendor.prep_time_minutes + 10} min
          </span>
          {vendor.vendor_scores && vendor.vendor_scores[0] && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: vendor.vendor_scores[0].visibility_tier === 'PREMIUM'
                  ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.05)',
                color: vendor.vendor_scores[0].visibility_tier === 'PREMIUM'
                  ? '#F5A623' : 'rgba(255,255,255,0.4)',
              }}>
              {vendor.vendor_scores[0].visibility_tier}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
