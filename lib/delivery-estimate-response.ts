export interface DeliveryEstimateResponse {
  distanceKm: number
  serviceFeeKobo: number
  deliveryFeeKobo: number
  activeSurchargeTotalKobo: number
}

export interface LaunchDeliveryQuoteResponse {
  roadDistanceMeters: number
  platformFeeKobo: number
  deliveryFeeKobo: number
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function toDeliveryEstimateResponse(
  quote: LaunchDeliveryQuoteResponse,
): DeliveryEstimateResponse | null {
  if (
    !finiteNonNegative(quote.roadDistanceMeters) ||
    !finiteNonNegative(quote.platformFeeKobo) ||
    !finiteNonNegative(quote.deliveryFeeKobo)
  ) return null

  return {
    distanceKm: Math.round((quote.roadDistanceMeters / 1_000) * 100) / 100,
    serviceFeeKobo: quote.platformFeeKobo,
    deliveryFeeKobo: quote.deliveryFeeKobo,
    activeSurchargeTotalKobo: 0,
  }
}

export function parseDeliveryEstimate(value: unknown): DeliveryEstimateResponse | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    !finiteNonNegative(candidate.distanceKm) ||
    !finiteNonNegative(candidate.serviceFeeKobo) ||
    !finiteNonNegative(candidate.deliveryFeeKobo) ||
    !finiteNonNegative(candidate.activeSurchargeTotalKobo)
  ) return null
  return {
    distanceKm: candidate.distanceKm,
    serviceFeeKobo: candidate.serviceFeeKobo,
    deliveryFeeKobo: candidate.deliveryFeeKobo,
    activeSurchargeTotalKobo: candidate.activeSurchargeTotalKobo,
  }
}
