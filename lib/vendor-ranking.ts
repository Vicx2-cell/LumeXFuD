export interface VendorRankingInputs {
  completedOrders30d: number
  cancelledOrders30d: number
  averageRating: number | null
  totalRatings: number
  averagePrepMinutes: number | null
  availabilityScore?: number
  deliveryPerformanceScore?: number
  conversionRate?: number
  menuQualityScore?: number
  freshnessScore?: number
  premiumBoost?: number
}

export interface VendorRankingResult {
  compositeScore: number
  visibilityTier: 'TOP' | 'STANDARD' | 'LOW'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function computeVendorRanking(inputs: VendorRankingInputs): VendorRankingResult {
  const completed = Math.max(0, inputs.completedOrders30d)
  const cancelled = Math.max(0, inputs.cancelledOrders30d)
  const total = completed + cancelled
  const cancelRate = total > 0 ? cancelled / total : 0
  const rating = clamp(inputs.averageRating ?? 0, 0, 5)
  const totalRatings = Math.max(0, inputs.totalRatings)
  const ratingConfidence = totalRatings > 0 ? clamp(totalRatings / 20, 0.2, 1) : 0
  const prepMinutes = inputs.averagePrepMinutes

  const salesScore = completed * 3
  const reviewScore = totalRatings > 0 ? ((rating - 3) * 12) * ratingConfidence : 0
  const volumeTrustScore = Math.min(totalRatings, 40) * 0.6
  const cancellationPenalty = cancelled * 3 + cancelRate * 20

  let prepScore = 0
  if (prepMinutes !== null) {
    if (prepMinutes <= 20) prepScore = 8
    else if (prepMinutes <= 30) prepScore = 4
    else if (prepMinutes >= 50) prepScore = -6
  }

  const availabilityScore = clamp(inputs.availabilityScore ?? (completed > 0 ? 1 : 0.6), 0, 1)
  const deliveryPerformanceScore = clamp(inputs.deliveryPerformanceScore ?? (1 - cancelRate), 0, 1)
  const conversionRate = clamp(inputs.conversionRate ?? (total > 0 ? completed / total : 0), 0, 1)
  const menuQualityScore = clamp(inputs.menuQualityScore ?? 0.5, 0, 1)
  const freshnessScore = clamp(inputs.freshnessScore ?? 0.5, 0, 1)
  const premiumBoost = clamp(inputs.premiumBoost ?? 0, 0, 6)

  const qualityScore =
    (availabilityScore * 5) +
    (deliveryPerformanceScore * 10) +
    (conversionRate * 8) +
    (menuQualityScore * 5) +
    (freshnessScore * 4)

  const compositeScore = Math.round((salesScore + reviewScore + volumeTrustScore + prepScore - cancellationPenalty + qualityScore + premiumBoost) * 100) / 100

  let visibilityTier: 'TOP' | 'STANDARD' | 'LOW' = 'STANDARD'
  if (completed >= 18 && cancelRate <= 0.12 && (totalRatings === 0 || rating >= 4.1)) {
    visibilityTier = 'TOP'
  } else if (completed <= 1 || cancelRate >= 0.35 || (totalRatings >= 5 && rating < 3.2)) {
    visibilityTier = 'LOW'
  }

  return { compositeScore, visibilityTier }
}
