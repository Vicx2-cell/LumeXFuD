import { haversineDistanceMeters } from './delivery-pricing'
import { evaluateRisk, type RiskEvaluation, type RiskSignal } from './risk-engine'

export interface LocationRiskFacts {
  distanceFromExpectedMeters: number | null
  gpsAccuracyMeters: number | null
  previousTravelMeters?: number | null
  elapsedSeconds?: number | null
  previousAccuracyMeters?: number | null
}

export function evaluateLocationRisk(facts: LocationRiskFacts): RiskEvaluation {
  const signals: RiskSignal[] = []
  const accuracy = facts.gpsAccuracyMeters
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy > 250) {
    if (accuracy != null) signals.push({
      code: 'location_low_accuracy', category: 'device_session',
      weight: 15, confidence: 0.3, strength: 'weak',
    })
    return evaluateRisk(signals)
  }

  const distance = facts.distanceFromExpectedMeters
  if (distance != null && distance > Math.max(750, accuracy * 4)) {
    signals.push({
      code: 'handover_location_inconsistent', category: 'order_abuse',
      weight: 45, confidence: 0.78, strength: 'moderate',
    })
  }
  if (distance != null && distance > 5_000 && accuracy <= 100) {
    signals.push({
      code: 'handover_location_extreme_distance', category: 'device_session',
      weight: 60, confidence: 0.85, strength: 'strong', corroborated: true,
    })
  }

  const elapsed = facts.elapsedSeconds
  const travel = facts.previousTravelMeters
  const previousAccuracy = facts.previousAccuracyMeters
  if (elapsed != null && elapsed >= 60 && elapsed <= 7_200 && travel != null &&
      previousAccuracy != null && previousAccuracy <= 250) {
    const speedKph = (travel / elapsed) * 3.6
    if (speedKph > 160) signals.push({
      code: 'location_implausible_travel', category: 'device_session',
      weight: 60, confidence: 0.82, strength: 'strong', corroborated: true,
    })
  }
  return evaluateRisk(signals)
}

export function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
}

export function distanceMeters(
  fromLat: number, fromLng: number, toLat: number, toLng: number,
): number {
  return haversineDistanceMeters({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng })
}
