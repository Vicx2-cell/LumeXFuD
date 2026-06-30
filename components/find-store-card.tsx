'use client'

import Image from 'next/image'
import { directionsUrl } from '@/lib/maps'
import { hasUsableLocation, type VendorLocation } from '@/lib/vendor-location'

// Customer-facing "Find this store" card on the vendor page. Shows the storefront
// photo, the address line and the rider landmark, and — the whole point — a big
// "Take me there" button that opens the phone's maps app and navigates to the
// exact pin. Renders nothing if the vendor has given no location at all.
export function FindStoreCard({ vendor, shopName }: { vendor: VendorLocation; shopName: string }) {
  if (!hasUsableLocation(vendor)) return null
  const dir = directionsUrl(vendor.latitude, vendor.longitude)

  return (
    <div className="lx-surface overflow-hidden">
      {vendor.location_photo_url && (
        <div className="relative w-full" style={{ aspectRatio: '16 / 7' }}>
          <Image src={vendor.location_photo_url} alt={`${shopName} storefront`} fill className="object-cover" sizes="100vw" />
        </div>
      )}
      <div className="p-4 space-y-2.5">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Find this store</p>
        {vendor.address_text && (
          <div className="flex items-start gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            <p className="text-sm text-white/85 leading-snug">{vendor.address_text}</p>
          </div>
        )}
        {vendor.landmark && (
          <p className="text-xs text-white/50 leading-snug pl-6">🚩 {vendor.landmark}</p>
        )}
        {dir ? (
          <a href={dir} target="_blank" rel="noopener noreferrer" className="lx-btn-amber w-full py-3 text-sm flex items-center justify-center gap-2" style={{ borderRadius: 14, minHeight: 48 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Take me there
          </a>
        ) : (
          <p className="text-xs text-white/35">Ask the vendor for the exact spot — no map pin set yet.</p>
        )}
      </div>
    </div>
  )
}
