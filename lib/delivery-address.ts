// ─── Delivery address: one canonical string, composed from clear parts ───────
//
// A campus address that's vague to a rider ("Chinaza Lodge") wastes minutes per
// drop and breeds disputes — which block? which room? We let the customer fill
// in STRUCTURED parts (lodge → block → room → directions) but still store ONE
// human-readable `orders.delivery_address` string, joined by " · ", so every
// existing consumer (rider list, order page, admin, WhatsApp notifications)
// keeps working with zero migration. The rider reads it back as a bold primary
// line + scannable chips via formatAddressForRider().
//
// Delivery shape drives what we ask for:
//   • BIKE — the rider brings it to your lodge and calls you down. Lodge (+ a
//     "where to meet" cue) is enough.
//   • DOOR — the rider walks to your actual room, so we need block (for
//     multi-block lodges) and room number, or they're left guessing.

export const ADDR_SEP = ' · '

export interface DeliveryAddressParts {
  lodge: string        // hostel / lodge / area — always required
  block?: string       // block / house, for multi-block lodges (door only)
  room?: string        // room number (door only)
  landmark?: string    // extra directions, or where to meet the rider (bike)
}

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim()

// Prefix a bare value with a noun unless the customer already typed one, so
// "B" → "Block B" and "12" → "Room 12", but "House 4" / "Room 12B" stay as-is.
const labelled = (value: string, noun: 'Block' | 'Room', keywords: RegExp) => {
  const v = clean(value)
  if (!v) return ''
  return keywords.test(v) ? v : `${noun} ${v}`
}

/** Build the canonical delivery_address string from the structured parts. */
export function composeDeliveryAddress(type: 'BIKE' | 'DOOR', parts: DeliveryAddressParts): string {
  const lodge = clean(parts.lodge)
  const landmark = clean(parts.landmark)
  if (type === 'BIKE') {
    // Bike drops at the lodge — the rider calls you down. Lodge + where to meet.
    return [lodge, landmark].filter(Boolean).join(ADDR_SEP)
  }
  // Door goes to your room — needs block (if the lodge has more than one) + room.
  const block = labelled(parts.block ?? '', 'Block', /\b(block|house|flat|wing|hostel|no\.?)\b/i)
  const room = labelled(parts.room ?? '', 'Room', /\b(room|rm)\b/i)
  return [lodge, block, room, landmark].filter(Boolean).join(ADDR_SEP)
}

// Minimal shape needed to resolve a chosen lodge string back to its catalog row.
export interface LodgeLike { name: string; area?: string | null; blocks?: string[] | null }

/**
 * Given the catalog and the lodge string the customer picked ("Name" or
 * "Name (Area)"), return that lodge's defined blocks. Empty array = free-typed
 * lodge or a lodge with no blocks → checkout uses the free-text block field.
 * Shared by the cart (validation) and the address composer (which UI to show)
 * so the two never disagree.
 */
export function lodgeBlocksFor(lodges: LodgeLike[], lodgeStr: string): string[] {
  const s = clean(lodgeStr)
  if (!s) return []
  const hit = lodges.find((l) => (l.area ? `${l.name} (${l.area})` : l.name) === s || l.name === s)
  return hit?.blocks ?? []
}

/** Split a stored address back into a primary line + secondary chips for display. */
export function formatAddressForRider(address: string): { primary: string; chips: string[] } {
  const raw = clean(address)
  if (!raw) return { primary: '', chips: [] }
  const parts = raw.split(ADDR_SEP).map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 1) return { primary: raw, chips: [] }
  return { primary: parts[0], chips: parts.slice(1) }
}
