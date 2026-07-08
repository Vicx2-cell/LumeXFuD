'use client'

import { Navigation, MapPin } from 'lucide-react'
import { type DeliveryAddressParts, composeDeliveryAddress, formatAddressForRider } from '@/lib/delivery-address'

interface Props {
  deliveryType: 'BIKE' | 'DOOR'
  value: DeliveryAddressParts
  onChange: (next: DeliveryAddressParts) => void
  placeLabel?: string
  manualPlaceholder?: string
}

export function DeliveryAddress({
  deliveryType,
  value,
  onChange,
  placeLabel,
  manualPlaceholder,
}: Props) {
  const set = (patch: Partial<DeliveryAddressParts>) => onChange({ ...value, ...patch })
  const preview = composeDeliveryAddress(deliveryType, value)
  const riderView = preview ? formatAddressForRider(preview) : null

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-2 block text-sm font-medium text-white/70">
          {deliveryType === 'DOOR' ? 'Where should we bring it?' : 'Where should we drop it?'}
        </label>
        <input
          type="text"
          value={value.lodge}
          onChange={(e) => set({ lodge: e.target.value })}
          placeholder={manualPlaceholder ?? (placeLabel ?? 'Type the location name')}
          autoComplete="off"
          enterKeyHint="next"
          className="lx-field w-full px-4 py-3 text-sm outline-none"
          aria-label={placeLabel ?? 'Location name'}
        />
      </div>

      <div>
        <input
          type="text"
          value={value.landmark ?? ''}
          onChange={(e) => set({ landmark: e.target.value })}
          placeholder="Landmark or note for the rider"
          autoComplete="off"
          enterKeyHint="done"
          className="lx-field w-full px-4 py-3 text-sm outline-none"
          aria-label="Landmark or note"
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-white/35">
        <MapPin size={13} className="mt-0.5 shrink-0 text-white/30" aria-hidden="true" />
        Pin your current location above, then type the exact place name here so the rider can find you fast.
      </p>

      {value.lodge.trim() && riderView && (
        <div className="lx-enter rounded-xl p-3" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)' }}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/45">
            <Navigation size={12} className="text-[#F5A623]" aria-hidden="true" /> What the rider sees
          </p>
          <p className="text-sm font-semibold leading-snug text-white">{riderView.primary}</p>
          {riderView.chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {riderView.chips.map((chip, i) => (
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
