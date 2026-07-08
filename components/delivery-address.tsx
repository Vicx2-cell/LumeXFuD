'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin, Map as MapIcon, DoorOpen, Navigation, ChevronDown, BadgeCheck } from 'lucide-react'
import { type MapLodge } from '@/components/lodge-map'
import { type DeliveryAddressParts, lodgeBlocksFor, composeDeliveryAddress, formatAddressForRider } from '@/lib/delivery-address'

const LodgeMap = dynamic(() => import('@/components/lodge-map').then((m) => ({ default: m.LodgeMap })), {
  ssr: false,
  loading: () => <div className="lx-skeleton rounded-2xl" style={{ height: 240 }} />,
})

interface Props {
  deliveryType: 'BIKE' | 'DOOR'
  value: DeliveryAddressParts
  onChange: (next: DeliveryAddressParts) => void
  suggestions: string[]
  lodges: MapLodge[]
  onCoords: (c: { lat: number; lng: number } | null) => void
}

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
  const [showMap, setShowMap] = useState(false)
  const [customLodge, setCustomLodge] = useState(false)

  const mapLodges = useMemo(() => lodges.filter((l) => l.latitude != null && l.longitude != null), [lodges])
  const lodgeOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const catalog = lodges.map((l) => l.area ? `${l.name} (${l.area})` : l.name)
    for (const option of [...catalog, ...suggestions]) {
      if (!option || seen.has(option)) continue
      seen.add(option)
      out.push(option)
    }
    return out
  }, [lodges, suggestions])
  const blocks = useMemo(() => lodgeBlocksFor(lodges, value.lodge), [lodges, value.lodge])
  const preview = useMemo(() => {
    const composed = composeDeliveryAddress(deliveryType, value)
    return composed ? formatAddressForRider(composed) : null
  }, [deliveryType, value])

  const set = (patch: Partial<DeliveryAddressParts>) => onChange({ ...value, ...patch })

  useEffect(() => {
    if (value.lodge.trim() && !lodgeOptions.includes(value.lodge.trim())) {
      setCustomLodge(true)
    }
  }, [value.lodge, lodgeOptions])

  const pickLodge = (picked: string) => {
    set({ lodge: picked, block: '' })
    onCoords(coordsFor(picked, lodges))
    setCustomLodge(false)
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-white/70">
        {isDoor ? 'Where exactly should we bring it?' : 'Where should the rider drop it?'}
      </label>

      <div className="space-y-2">
        {lodgeOptions.length > 0 && (
          <div className="relative">
            <select
              value={customLodge ? '__OTHER__' : value.lodge}
              onChange={(e) => {
                const next = e.target.value
                if (next === '__OTHER__') {
                  setCustomLodge(true)
                  set({ lodge: '', block: '' })
                  onCoords(null)
                  return
                }
                pickLodge(next)
              }}
              className="lx-field w-full appearance-none px-3.5 py-3 pr-9 text-sm outline-none"
              style={{ colorScheme: 'dark' }}
              aria-label="Choose your lodge or hostel"
            >
              <option value="">Choose your lodge or hostel</option>
              {lodgeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              <option value="__OTHER__">My lodge is not listed</option>
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/40" aria-hidden="true" />
          </div>
        )}

        {(customLodge || lodgeOptions.length === 0) && (
          <input
            type="text"
            value={value.lodge}
            onChange={(e) => { set({ lodge: e.target.value, block: '' }); onCoords(null) }}
            placeholder={isDoor ? 'Type your lodge or hostel' : 'Type your lodge / area'}
            autoComplete="off"
            enterKeyHint={isDoor ? 'next' : 'done'}
            className="lx-field w-full px-4 py-3 text-sm outline-none"
            aria-label="Lodge or hostel"
          />
        )}

        {lodgeOptions.length > 0 && (
          <p className="text-xs text-white/35">Choose your lodge from the list. If it is missing, switch to manual entry and type it yourself.</p>
        )}
      </div>

      {mapLodges.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            className="lx-amber inline-flex items-center gap-1.5 text-xs font-medium"
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
                  const picked = lo.area ? `${lo.name} (${lo.area})` : lo.name
                  pickLodge(picked)
                  if (lo.latitude != null && lo.longitude != null) onCoords({ lat: lo.latitude, lng: lo.longitude })
                  setShowMap(false)
                }}
              />
              <p className="mt-1 text-xs text-white/35">Tap your lodge pin to set it as your drop-off.</p>
            </div>
          )}
        </div>
      )}

      {isDoor ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              {blocks.length > 0 ? (
                <>
                  <label className="mb-1.5 block text-xs text-white/45">Block <span className="text-[#F5A623]/70">*</span></label>
                  <div className="relative">
                    <select
                      value={value.block ?? ''}
                      onChange={(e) => set({ block: e.target.value })}
                      className="lx-field w-full appearance-none px-3.5 py-3 pr-9 text-sm outline-none"
                      style={{ colorScheme: 'dark' }}
                      aria-label="Block"
                    >
                      <option value="">Choose your block</option>
                      {blocks.map((block) => <option key={block} value={block}>{block}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/40" aria-hidden="true" />
                  </div>
                </>
              ) : (
                <>
                  <label className="mb-1.5 block text-xs text-white/45">Block / House <span className="text-white/25">(if more than one)</span></label>
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
              <label className="mb-1.5 block text-xs text-white/45">Room number <span className="text-[#F5A623]/70">*</span></label>
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
          <p className="mt-2 flex items-start gap-1.5 text-xs text-white/35">
            <DoorOpen size={13} className="mt-0.5 shrink-0 text-white/30" aria-hidden="true" />
            For door delivery the rider comes to your room, so the clearer the block and room, the faster it reaches you.
          </p>
        </>
      ) : (
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
          <p className="mt-2 flex items-start gap-1.5 text-xs text-white/35">
            <Navigation size={13} className="mt-0.5 shrink-0 text-white/30" aria-hidden="true" />
            For bike delivery the rider brings it to your lodge and calls you to come down.
          </p>
        </>
      )}

      {value.lodge.trim() && preview && (
        <div className="lx-enter mt-3 rounded-xl p-3" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)' }}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/45">
            <BadgeCheck size={12} className="text-[#F5A623]" aria-hidden="true" /> What your rider sees
          </p>
          <p className="text-sm font-semibold leading-snug text-white">{preview.primary}</p>
          {preview.chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {preview.chips.map((chip, i) => (
                <span key={i} className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: 'rgba(245,166,35,0.14)', color: '#F5A623' }}>
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
