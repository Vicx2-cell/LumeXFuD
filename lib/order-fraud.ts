import { createHash } from 'node:crypto'
import { evaluateRisk, type RiskEvaluation, type RiskSignal } from './risk-engine'

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

export function normalizeIdempotencyKey(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return IDEMPOTENCY_KEY_RE.test(trimmed) ? trimmed : null
}

export interface OrderIntent {
  customerId: string | null
  vendorId: string
  items: Array<{ menuItemId: string; quantity: number; addonIds: string[] }>
  deliveryType: string
  destinationHash: string
  paymentMethod: string
  applyReward: boolean
  groupOrderId: string | null
  scheduledFor: string | null
  subtotalKobo: number
  totalKobo: number
}

export function hashOrderDestination(input: {
  address: string
  latitude: number | null
  longitude: number | null
}): string {
  return createHash('sha256').update(JSON.stringify({
    address: input.address.trim().replace(/\s+/g, ' ').toLowerCase(),
    latitude: input.latitude,
    longitude: input.longitude,
  })).digest('hex')
}

/** Hash only canonical, server-authoritative order facts; never address/GPS/notes. */
export function hashOrderIntent(intent: OrderIntent): string {
  const canonical = {
    customerId: intent.customerId,
    vendorId: intent.vendorId,
    items: intent.items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      addonIds: [...item.addonIds].sort(),
    })).sort((a, b) => `${a.menuItemId}:${a.quantity}:${a.addonIds.join(',')}`.localeCompare(`${b.menuItemId}:${b.quantity}:${b.addonIds.join(',')}`)),
    deliveryType: intent.deliveryType,
    destinationHash: intent.destinationHash,
    paymentMethod: intent.paymentMethod,
    applyReward: intent.applyReward,
    groupOrderId: intent.groupOrderId,
    scheduledFor: intent.scheduledFor,
    subtotalKobo: intent.subtotalKobo,
    totalKobo: intent.totalKobo,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function evaluateOrderCreationRisk(facts: {
  pendingOrders30m: number
  totalItemQuantity: number
  idempotencyPayloadMismatch?: boolean
}): RiskEvaluation {
  const signals: RiskSignal[] = []
  if (facts.pendingOrders30m >= 5) signals.push({
    code: 'order_unpaid_velocity_30m', category: 'order_abuse',
    weight: 45, confidence: 0.8, strength: 'moderate',
  })
  if (facts.totalItemQuantity >= 30) signals.push({
    code: 'order_unusual_item_quantity', category: 'order_abuse',
    weight: 25, confidence: 0.55, strength: 'weak',
  })
  if (facts.idempotencyPayloadMismatch) signals.push({
    code: 'order_idempotency_payload_mismatch', category: 'order_abuse',
    weight: 65, confidence: 0.95, strength: 'strong', corroborated: true,
  })
  return evaluateRisk(signals)
}
