// ─── Maps / directions deep links ────────────────────────────────────────────
// The "5-year-old can find it" primitive: turn a pin into a link that opens the
// phone's OWN maps app and navigates there turn-by-turn. The Google Maps
// universal URL is the most reliable cross-platform target — on Android it opens
// the Google Maps app, on iOS it opens Google Maps (if installed) or Apple's map
// in Safari. No API key, no SDK, nothing to load.

export function hasPin(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) &&
    typeof lng === 'number' && Number.isFinite(lng)
  )
}

// A turn-by-turn DIRECTIONS link to a pin (rider/customer taps → maps navigates).
// Returns null when there is no usable pin, so callers can hide the button.
export function directionsUrl(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (!hasPin(lat, lng)) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

// A "show this place on a map" link (no routing) — used where we just want to
// drop someone onto the pin. Falls back to a text search when there is no pin.
export function mapViewUrl(
  lat: number | null | undefined,
  lng: number | null | undefined,
  query?: string | null,
): string | null {
  if (hasPin(lat, lng)) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  if (query && query.trim()) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`
  return null
}
