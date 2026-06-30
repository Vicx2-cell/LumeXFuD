// ─── Vendor store location (address + map pinpoint) ──────────────────────────
// Pure, framework-free logic for the vendor "Where is your store?" feature. The
// API route and the client editor stay thin and lean on these helpers (mirrors
// lib/saved-places.ts). Distinct from a customer's saved places — this is the
// PUBLIC physical location of a shop, shown to customers and riders so they can
// find and navigate to it.

export interface VendorLocation {
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  location_photo_url: string | null
}

export const ADDRESS_MAX = 160
export const LANDMARK_MAX = 120

export interface CleanVendorLocation {
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
}

export type CleanResult =
  | { ok: true; value: CleanVendorLocation }
  | { ok: false; error: string }

function cleanCoord(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return NaN
  return n
}

// Normalize + validate the vendor-supplied location fields. A pin is all-or-
// nothing (a latitude with no longitude is unmappable), so a half-pin is
// rejected rather than silently dropped. Every field is optional — a vendor can
// save just a landmark, just a pin, or clear everything.
export function cleanVendorLocation(input: {
  address_text?: unknown
  landmark?: unknown
  latitude?: unknown
  longitude?: unknown
}): CleanResult {
  let address_text: string | null = null
  if (typeof input.address_text === 'string') {
    const t = input.address_text.trim()
    if (t) {
      if (t.length > ADDRESS_MAX) return { ok: false, error: `Address must be ${ADDRESS_MAX} characters or fewer` }
      address_text = t
    }
  }

  let landmark: string | null = null
  if (typeof input.landmark === 'string') {
    const t = input.landmark.trim()
    if (t) {
      if (t.length > LANDMARK_MAX) return { ok: false, error: `Landmark must be ${LANDMARK_MAX} characters or fewer` }
      landmark = t
    }
  }

  const lat = cleanCoord(input.latitude)
  const lng = cleanCoord(input.longitude)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { ok: false, error: 'Coordinates must be numbers' }
  if ((lat === null) !== (lng === null)) {
    return { ok: false, error: 'A pin needs both a latitude and a longitude' }
  }
  if (lat !== null && (lat < -90 || lat > 90)) return { ok: false, error: 'Latitude is out of range' }
  if (lng !== null && (lng < -180 || lng > 180)) return { ok: false, error: 'Longitude is out of range' }

  return { ok: true, value: { address_text, landmark, latitude: lat, longitude: lng } }
}

// True once a vendor has given customers/riders SOMETHING to find them by — a
// pin, an address, or a landmark. Drives the "add your location" nudge.
export function hasUsableLocation(v: Partial<VendorLocation> | null | undefined): boolean {
  if (!v) return false
  const pinned = typeof v.latitude === 'number' && typeof v.longitude === 'number'
  return pinned || !!(v.address_text && v.address_text.trim()) || !!(v.landmark && v.landmark.trim())
}

// The single human line that best describes the spot, for compact display.
export function locationSummary(v: Partial<VendorLocation> | null | undefined): string | null {
  if (!v) return null
  if (v.address_text && v.address_text.trim()) return v.address_text.trim()
  if (v.landmark && v.landmark.trim()) return v.landmark.trim()
  return null
}
