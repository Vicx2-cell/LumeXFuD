// ─── Saved places (customer-managed delivery locations) ──────────────────────
// Pure, framework-free logic for the "Saved places" feature: a customer can save
// named delivery locations (label + optional landmark/pin/photo) and mark ONE as
// "your usual" for one-tap reuse at checkout. The API routes and the client page
// stay thin and lean on the helpers here (mirrors lib/demand.ts, lib/catalog.ts).
//
// Distinct from customer_addresses (migration 050), which is the app PASSIVELY
// learning where you order; saved places are DELIBERATE, named, and editable.

export interface SavedPlace {
  id: string
  label: string
  landmark: string | null
  latitude: number | null
  longitude: number | null
  // Storage key in the private place-photos bucket (never a public URL). The list
  // endpoint swaps this for a short-lived signed `photo_url` before returning.
  photo_path: string | null
  is_default: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

// A customer can save a generous but bounded number of places — enough for home,
// hostel, a friend's lodge, faculty, etc., without letting the list grow unbounded.
export const MAX_SAVED_PLACES = 15

export const LABEL_MAX = 60
export const LANDMARK_MAX = 120

export interface CleanPlaceFields {
  label: string
  landmark: string | null
  latitude: number | null
  longitude: number | null
}

export type CleanResult =
  | { ok: true; value: CleanPlaceFields }
  | { ok: false; error: string }

function cleanCoord(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return NaN
  return n
}

// Normalize + validate the user-supplied fields shared by create and update.
// Returns a trimmed, coordinate-coerced payload or a human-readable error. A pin
// is all-or-nothing: you can't store a latitude without a longitude (it would be
// unmappable) — so reject a half-pin rather than silently dropping it.
export function cleanPlaceFields(input: {
  label?: unknown
  landmark?: unknown
  latitude?: unknown
  longitude?: unknown
}): CleanResult {
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (!label) return { ok: false, error: 'A label is required' }
  if (label.length > LABEL_MAX) return { ok: false, error: `Label must be ${LABEL_MAX} characters or fewer` }

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

  return { ok: true, value: { label, landmark, latitude: lat, longitude: lng } }
}

// True if the customer can save another place.
export function canAddPlace(currentCount: number): boolean {
  return currentCount < MAX_SAVED_PLACES
}

// Stable ordering for the list view: "your usual" first, then the genuinely most-
// reused, then most-recently-used, then newest. Deterministic given equal inputs.
export function sortPlaces<T extends SavedPlace>(places: readonly T[]): T[] {
  return [...places].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
    if (a.use_count !== b.use_count) return b.use_count - a.use_count
    const at = a.last_used_at ? Date.parse(a.last_used_at) : 0
    const bt = b.last_used_at ? Date.parse(b.last_used_at) : 0
    if (at !== bt) return bt - at
    const ac = Date.parse(a.created_at)
    const bc = Date.parse(b.created_at)
    return bc - ac
  })
}

// Resolve "your usual": the explicit default if one is set, otherwise the most-
// reused place (per sortPlaces). null when the customer has saved nothing.
export function pickUsual<T extends SavedPlace>(places: readonly T[]): T | null {
  if (places.length === 0) return null
  const explicit = places.find((p) => p.is_default)
  if (explicit) return explicit
  return sortPlaces(places)[0] ?? null
}

// The single-line address a place contributes to the cart when reused. Prefers
// "Label — landmark" so the rider gets the human cue, falling back to the label.
export function placeToAddress(place: Pick<SavedPlace, 'label' | 'landmark'>): string {
  return place.landmark ? `${place.label} — ${place.landmark}` : place.label
}
