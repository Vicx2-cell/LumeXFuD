export interface DeliveryEstimateResponse {
  distanceKm: number
  serviceFeeKobo: number
  deliveryFeeKobo: number
  activeSurchargeTotalKobo: number
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
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
