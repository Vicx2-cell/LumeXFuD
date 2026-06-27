'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin, Search, Map as MapIcon, DoorOpen, Navigation, ChevronDown, BadgeCheck } from 'lucide-react'
import { type MapLodge } from '@/components/lodge-map'
import { type DeliveryAddressParts, lodgeBlocksFor, composeDeliveryAddress, formatAddressForRider } from '@/lib/delivery-address'

// Defer the map (and Leaflet's CSS) until the customer actually opens it.
const LodgeMap = dynamic(() => import('@/components/lodge-map').then((m) => ({ default: m.LodgeMap })), {
  ssr: false,
  loading: () => <div className="lx-skeleton rounded-2xl" style={{ height: 240 }} />,
})

interface Props {
  deliveryType: 'BIKE' | 'DOOR'
  value: DeliveryAddressParts
  onChange: (next: DeliveryAddressParts) => void
  /** Learned lodges (personal first) + the verified ABSU catalog — search source. */
  suggestions: string[]
  /** Catalog lodges that carry coordinates (for the map + GPS pin). */
  lodges: MapLodge[]
  /** Bubble up GPS for this drop (set on map/suggestion pick, cleared on hand-edit). */
  onCoords: (c: { lat: number; lng: number } | null) => void
}

// A tapped suggestion may be "Name (Area)" — match it back to a catalog lodge so
// we can attach its GPS pin. Falls back to a plain-name match.
function coordsFor(picked: string, lodges: MapLodge[]): { lat: number; lng: number } | null {
  const hit = lodges.find((l) => {
    const full = l.area ? `${l.name} (${l.area})` : l.name
    return full === picked || l.name === picked
  })
  if (hit && hit.latitude != null && hit.longitude != null) return { lat: hit.latitude, lng: hit.longitude }
  return null
}

export function DeliveryAddress({ deliveryType, value, onChange, suggestions, lodges, onCoords }: Props) {
  const isDoor = deliveryType === 'DOOR'
  const [open, setOpen]       = useState(false) // suggestion dropdown
  const [showMap, setShowMap] = useState(false)

  const mapLodges = useMemo(() => lodges.filter((l) => l.latitude != null && l.longitude != null), [lodges])

  // Filter suggestions by what's typed; cap the list so the keyboard isn't buried.
  const matches = useMemo(() => {
    const q = value.lodge.trim().toLowerCase()
    const pool = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions
    return pool.slice(0, 6)
  }, [value.lodge, suggestions])

  // Blocks defined for whichever lodge is currently chosen (empty when the lodge
  // is free-typed or single-block). Drives whether Block is a dropdown or free text.
  const blocks = useMemo(() => lodgeBlocksFor(lodges, value.lodge), [lodges, value.lodge])

  // Live "what your rider sees" preview. Confirming the resolved address back to
  // the customer BEFORE payment is the single biggest lever on failed deliveries
  // (Baymard / Veho: structured address + confirmation nudge cuts failures 30–77%).
  const preview = useMemo(() => {
    const composed = composeDeliveryAddress(deliveryType, value)
    return composed ? formatAddressForRider(composed) : null
  }, [deliveryType, value])

  const set = (patch: Partial<DeliveryAddressParts>) => onChange({ ...value, ...patch })

  // Picking a different lodge clears the block — a block from lodge A is
  // meaningless at lodge B, and the dropdown options change.
  const pickLodge = (s: string) => {
    set({ lodge: s, block: '' })
    onCoords(coordsFor(s, lodges))
    setOpen(false)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">
        {isDoor ? 'Where exactly should we bring it?' : 'Where should the rider drop it?'}
      </label>

      {/* Lodge / hostel — searchable, with a free-type fallback */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" aria-hidden="true" />
        <input
          type="text"
          value={value.lodge}
          onChange={(e) => { set({ lodge: e.target.value }); onCoords(null); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={isDoor ? 'Search your lodge, or type it' : 'Search your lodge / area, or type it'}
          autoComplete="off"
          enterKeyHint={isDoor ? 'next' : 'done'}
          className="lx-field w-full pl-10 pr-4 py-3 text-sm outline-none"
          aria-label="Lodge or hostel"
        />
        {open && matches.length > 0 && (
          <div
            className="absolute z-20 left-0 right-0 mt-1.5 rounded-xl overflow-hidden lx-enter"
            style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}
          >
            {matches.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pickLodge(s)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-white/5"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <MapPin size={14} className="text-[#F5A623] shrink-0" aria-hidden="true" />
                <span className="truncate text-white/80">{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pick on the ABSU map — attaches a precise GPS pin for the rider */}
      {mapLodges.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => { setShowMap((v) => !v); setOpen(false) }}
            className="lx-amber text-xs font-medium inline-flex items-center gap-1.5"
          >
            <MapIcon size={13} aria-hidden="true" />
            {showMap ? 'Hide map' : 'Pick your lodge on the map'}
          </button>
          {showMap && (
            <div className="mt-2 lx-enter">
              <LodgeMap
                lodges={mapLodges}
                height={240}
                onSelect={(lo) => {
                  set({ lodge: lo.area ? `${lo.name} (${lo.area})` : lo.name, block: '' })
                  if (lo.latitude != null && lo.longitude != null) onCoords({ lat: lo.latitude, lng: lo.longitude })
                  setShowMap(false)
                }}
              />
              <p className="text-xs text-white/35 mt-1">Tap your lodge’s pin to set it as your drop-off.</p>
            </div>
          )}
        </div>
      )}

      {/* DOOR — block + room so the rider walks straight to the right door */}
      {isDoor ? (
        <>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              {blocks.length > 0 ? (
                // This lodge has defined blocks → pick the exact one (no mistyping).
                <>
                  <label className="block text-xs text-white/45 mb-1.5">Block <span className="text-[#F5A623]/70">*</span></label>
                  <div className="relative">
                    <select
                      value={value.block ?? ''}
                      onChange={(e) => set({ block: e.target.value })}
                      className="lx-field w-full px-3.5 py-3 text-sm outline-none appearance-none pr-9"
                      style={{ colorScheme: 'dark' }}
                      aria-label="Block"
                    >
                      <option value="">Choose your block</option>
                      {blocks.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" aria-hidden="true" />
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-xs text-white/45 mb-1.5">Block / House <span className="text-white/25">(if more than one)</span></label>
                  <input
                    type="text"
                    value={value.block ?? ''}
                    onChange={(e) => set({ block: e.target.value })}
                    placeholder="e.g. Block B"
                    autoComplete="off"
                    enterKeyHint="next"
                    className="lx-field w-full px-3.5 py-3 text-sm outline-none"
                    aria-label="Block or house"
                  />
                </>
              )}
            </div>
            <div>
              <label className="block text-xs text-white/45 mb-1.5">Room number <span className="text-[#F5A623]/70">*</span></label>
              <input
                type="text"
                inputMode="numeric"
                value={value.room ?? ''}
                onChange={(e) => set({ room: e.target.value })}
                placeholder="e.g. 12"
                autoComplete="off"
                enterKeyHint="next"
                className="lx-field w-full px-3.5 py-3 text-sm outline-none"
                aria-label="Room number"
              />
            </div>
          </div>
          <div className="mt-3">
            <input
              type="text"
              value={value.landmark ?? ''}
              onChange={(e) => set({ landmark: e.target.value })}
              placeholder="Landmark for the rider — e.g. green gate, last floor"
              autoComplete="off"
              enterKeyHint="done"
              className="lx-field w-full px-3.5 py-3 text-sm outline-none"
              aria-label="Landmark or directions"
            />
          </div>
          <p className="text-xs text-white/35 mt-2 flex items-start gap-1.5">
            <DoorOpen size={13} className="text-white/30 shrink-0 mt-0.5" aria-hidden="true" />
            For door delivery the rider comes to your room — the clearer the block &amp; room, the faster it reaches you.
          </p>
        </>
      ) : (
        // BIKE — lighter: just where to meet. Rider brings it to the lodge.
        <>
          <div className="mt-3">
            <input
              type="text"
              value={value.landmark ?? ''}
              onChange={(e) => set({ landmark: e.target.value })}
              placeholder="Where will you meet the rider? e.g. at the gate"
              autoComplete="off"
              enterKeyHint="done"
              className="lx-field w-full px-3.5 py-3 text-sm outline-none"
              aria-label="Where to meet the rider"
            />
          </div>
          <p className="text-xs text-white/35 mt-2 flex items-start gap-1.5">
            <Navigation size={13} className="text-white/30 shrink-0 mt-0.5" aria-hidden="true" />
            For bike delivery the rider brings it to your lodge and calls you to come down.
          </p>
        </>
      )}

      {/* Live confirmation — exactly what the rider will read. Lets the customer
          catch a wrong block/room before paying, not after a failed drop. */}
      {value.lodge.trim() && preview && (
        <div className="mt-3 rounded-xl p-3 lx-enter" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)' }}>
          <p className="text-[10px] uppercase tracking-wide text-white/45 mb-1.5 flex items-center gap-1.5">
            <BadgeCheck size={12} className="text-[#F5A623]" aria-hidden="true" /> What your rider sees
          </p>
          <p className="text-sm font-semibold text-white leading-snug">{preview.primary}</p>
          {preview.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {preview.chips.map((c, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ background: 'rgba(245,166,35,0.14)', color: '#F5A623' }}>{c}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
