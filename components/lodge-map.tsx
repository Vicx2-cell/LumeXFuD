'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LMap, DivIcon } from 'leaflet'

export interface MapLodge {
  id: string
  name: string
  area?: string | null
  latitude: number | null
  longitude: number | null
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

      for (const lo of withCoords) {
        const m = L.marker([lo.latitude as number, lo.longitude as number], { icon }).addTo(map)
        m.bindPopup(lo.area ? `${lo.name} — ${lo.area}` : lo.name)
        if (onSelectRef.current) m.on('click', () => onSelectRef.current?.(lo))
      }

      // Admin pin-drop: tap to set coordinates (single moving marker).
      let dropped: ReturnType<typeof L.marker> | null = null
      if (onPick) {
        map.on('click', (e) => {
          const { lat, lng } = e.latlng
          if (dropped) dropped.setLatLng(e.latlng)
          else dropped = L.marker(e.latlng, { icon }).addTo(map)
          onPickRef.current?.(lat, lng)
        })
      }

      // Leaflet needs a size recalc after layout settles.
      setTimeout(() => map.invalidateSize(), 100)

      cleanup = () => { map.remove(); mapRef.current = null }
    })

    return () => { cancelled = true; cleanup() }
    // Re-init when the set of plotted lodges changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lodges])

  // Reflect an externally-controlled provisional pin (admin form lat/lng inputs).
  useEffect(() => {
    if (!pin || !mapRef.current) return
    mapRef.current.setView([pin.lat, pin.lng], Math.max(mapRef.current.getZoom(), 16))
  }, [pin])

  // Fixed height keeps the reserved box stable (no layout shift while Leaflet
  // boots); width is clamped so the tile canvas can never push past a 360px
  // viewport. Container sizing only — map logic above is untouched.
  return <div ref={elRef} style={{ height, width: '100%', maxWidth: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }} />
}
