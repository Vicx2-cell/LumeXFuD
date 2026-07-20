'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'

// Campus map of where active orders are being delivered. Plots each order that
// has delivery coordinates as a circle (colour = severity), so a glance shows
// where demand — and trouble — is concentrated. Leaflet is loaded dynamically
// inside the effect (it touches `window`), so this never runs on the server.
//
// NOTE: this shows delivery DESTINATIONS, not live rider positions — the rider
// app doesn't stream GPS yet (that's a separate phase). Circle markers avoid
// Leaflet's broken default-icon asset paths entirely.

export interface MapPoint {
  id: string
  order_number: string
  lat: number
  lng: number
  severity: 'critical' | 'warn' | 'none'
  status: string
}

// ABSU, Uturu — campus centre fallback when no points have coordinates yet.
const ABSU_CENTER: [number, number] = [5.8767, 7.4516]

const SEV_COLOR = { critical: '#EF4444', warn: '#F5A623', none: '#22C55E' } as const

export default function OpsMap({ points }: { points: MapPoint[] }) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const fittedRef = useRef(false)
  const pointsRef = useRef<MapPoint[]>(points)
  pointsRef.current = points

  // Init once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !elRef.current || mapRef.current) return

      const map = L.map(elRef.current, {
        center: ABSU_CENTER,
        zoom: 14,
        zoomControl: true,
        attributionControl: false,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map)
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)
      renderMarkers(L)
    })()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Re-render markers whenever the points change.
  useEffect(() => {
    ;(async () => {
      if (!mapRef.current || !layerRef.current) return
      const L = (await import('leaflet')).default
      renderMarkers(L)
    })()
  }, [points])

  function renderMarkers(L: typeof import('leaflet')) {
    const layer = layerRef.current
    const map = mapRef.current
    if (!layer || !map) return
    layer.clearLayers()

    const located = pointsRef.current.filter(
      (p) => typeof p.lat === 'number' && typeof p.lng === 'number',
    )
    const latlngs: [number, number][] = []
    for (const p of located) {
      const color = SEV_COLOR[p.severity]
      L.circleMarker([p.lat, p.lng], {
        radius: p.severity === 'critical' ? 9 : 7,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.55,
      })
        .bindTooltip(`#${p.order_number} · ${p.status}`, { direction: 'top' })
        .addTo(layer)
      latlngs.push([p.lat, p.lng])
    }

    // Fit to the points the first time we have any (don't fight the user's pan).
    if (latlngs.length > 0 && !fittedRef.current) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.3), { maxZoom: 16 })
      fittedRef.current = true
    }
  }

  return (
    <div
      ref={elRef}
      className="w-full rounded-2xl overflow-hidden"
      style={{ height: 280, background: '#0e0e10', border: '1px solid rgba(255,255,255,0.08)' }}
      aria-label="Map of active order delivery locations"
    />
  )
}
