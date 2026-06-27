'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LMap, DivIcon, Marker as LMarker } from 'leaflet'
type LeafletModule = typeof import('leaflet')

export interface MapLodge {
  id: string
  name: string
  area?: string | null
  latitude: number | null
  longitude: number | null
  // Ordered list of the lodge's blocks (Block A, Block B…). Empty = single block.
  blocks?: string[] | null
}

// ABSU main campus, Uturu (Abia State). Default centre when nothing else fits.
const ABSU_CENTER: [number, number] = [5.6264, 7.4707]

interface LodgeMapProps {
  lodges: MapLodge[]
  height?: number
  // Admin "drop a pin" mode: tapping the map reports coordinates.
  onPick?: (lat: number, lng: number) => void
  // Customer mode: tapping a lodge marker selects it.
  onSelect?: (lodge: MapLodge) => void
  // A provisional pin (e.g. the coords being entered in the admin form).
  pin?: { lat: number; lng: number } | null
}

// Vanilla Leaflet (no react-leaflet — avoids React 19 peer issues). Leaflet is
// imported dynamically inside the effect so the module never touches `window`
// during SSR. Markers use a divIcon (emoji) so there are NO external image
// requests beyond the OSM tiles (already allowed in the CSP).
export function LodgeMap({ lodges, height = 280, onPick, onSelect, pin }: LodgeMapProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LMap | null>(null)
  const lRef = useRef<LeafletModule | null>(null)
  const iconRef = useRef<DivIcon | null>(null)
  const pinMarkerRef = useRef<LMarker | null>(null)
  // Keep the latest callbacks without forcing a full map re-init.
  const onPickRef = useRef(onPick)
  const onSelectRef = useRef(onSelect)
  onPickRef.current = onPick
  onSelectRef.current = onSelect

  // Init once.
  useEffect(() => {
    let cancelled = false
    let cleanup = () => {}

    import('leaflet').then((L) => {
      if (cancelled || !elRef.current || mapRef.current) return

      const withCoords = lodges.filter((l) => l.latitude != null && l.longitude != null)
      const center: [number, number] = withCoords.length
        ? [withCoords[0].latitude as number, withCoords[0].longitude as number]
        : ABSU_CENTER

      const map = L.map(elRef.current).setView(center, 15)
      mapRef.current = map
      lRef.current = L

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map)

      const icon: DivIcon = L.divIcon({
        className: 'lx-lodge-pin',
        html: '<div style="font-size:22px;line-height:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">📍</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      })
      iconRef.current = icon

      for (const lo of withCoords) {
        const m = L.marker([lo.latitude as number, lo.longitude as number], { icon }).addTo(map)
        m.bindPopup(lo.area ? `${lo.name} — ${lo.area}` : lo.name)
        if (onSelectRef.current) m.on('click', () => onSelectRef.current?.(lo))
      }

      // Tap to set coordinates. The VISIBLE marker is driven by the `pin` prop
      // (effect below) so a tap AND a geolocation capture both drop a pin.
      if (onPick) {
        map.on('click', (e) => onPickRef.current?.(e.latlng.lat, e.latlng.lng))
      }

      // Leaflet needs a size recalc after layout settles.
      setTimeout(() => map.invalidateSize(), 100)

      cleanup = () => { map.remove(); mapRef.current = null }
    })

    return () => { cancelled = true; cleanup() }
    // Re-init when the set of plotted lodges changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lodges])

  // Reflect an externally-controlled pin (geolocation capture OR the lat/lng the
  // user taps in): drop/move a VISIBLE marker there and recenter on it. Without
  // the marker, capturing location just panned the map with nothing to see —
  // which read as "it isn't pinpointing".
  useEffect(() => {
    const map = mapRef.current
    const L = lRef.current
    if (!map || !L) return
    if (pin) {
      const ll: [number, number] = [pin.lat, pin.lng]
      if (pinMarkerRef.current) {
        pinMarkerRef.current.setLatLng(ll)
      } else {
        pinMarkerRef.current = L.marker(ll, iconRef.current ? { icon: iconRef.current } : undefined).addTo(map)
      }
      map.setView(ll, Math.max(map.getZoom(), 16))
    } else if (pinMarkerRef.current) {
      pinMarkerRef.current.remove()
      pinMarkerRef.current = null
    }
  }, [pin])

  // Fixed height keeps the reserved box stable (no layout shift while Leaflet
  // boots); width is clamped so the tile canvas can never push past a 360px
  // viewport. Container sizing only — map logic above is untouched.
  return <div ref={elRef} style={{ height, width: '100%', maxWidth: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }} />
}
