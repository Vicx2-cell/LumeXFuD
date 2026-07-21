import { describe, expect, it } from 'vitest'
import { distanceMeters, evaluateLocationRisk, validCoordinates } from '@/lib/location-risk'

describe('lawful accuracy-aware location risk', () => {
  it('validates finite coordinate pairs', () => {
    expect(validCoordinates(6.4, 5.6)).toBe(true)
    expect(validCoordinates(Number.NaN, 5.6)).toBe(false)
    expect(validCoordinates(91, 5.6)).toBe(false)
  })

  it('keeps missing or poor-accuracy location observe-only', () => {
    expect(evaluateLocationRisk({ distanceFromExpectedMeters: 10_000, gpsAccuracyMeters: null }).actions).toEqual(['observe'])
    const poor = evaluateLocationRisk({ distanceFromExpectedMeters: 10_000, gpsAccuracyMeters: 1_000 })
    expect(poor.triggeredRules).toEqual(['location_low_accuracy'])
    expect(poor.actions).toEqual(['observe'])
  })

  it('does not flag a plausible handover within the accuracy-aware radius', () => {
    const risk = evaluateLocationRisk({ distanceFromExpectedMeters: 500, gpsAccuracyMeters: 100 })
    expect(risk.triggeredRules).toEqual([])
  })

  it('records corroborated extreme distance and implausible travel without identity claims', () => {
    const risk = evaluateLocationRisk({
      distanceFromExpectedMeters: 8_000, gpsAccuracyMeters: 30,
      previousTravelMeters: 10_000, elapsedSeconds: 120, previousAccuracyMeters: 40,
    })
    expect(risk.triggeredRules).toEqual(expect.arrayContaining([
      'handover_location_inconsistent', 'handover_location_extreme_distance', 'location_implausible_travel',
    ]))
    expect(risk.actions as string[]).not.toContain('permanent_ban')
  })

  it('uses operational distance calculation', () => {
    expect(distanceMeters(6.0, 5.0, 6.0, 5.0)).toBe(0)
  })
})
