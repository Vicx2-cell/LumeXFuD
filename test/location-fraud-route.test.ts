import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('delivery location inconsistency evidence', () => {
  const deliver = read('app/api/orders/[id]/deliver/route.ts')
  const status = read('app/api/orders/[id]/status/route.ts')
  const statusEmail = read('lib/order-status-email.ts')

  it('computes accuracy-aware expected and prior travel distance after the handover claim', () => {
    expect(deliver).toMatch(/distanceFromExpected = hasCurrentLocation && hasExpectedLocation/i)
    expect(deliver).toMatch(/from\('order_status_events'\)/i)
    expect(deliver).toMatch(/previousTravelMeters = distanceMeters/i)
    expect(deliver).toMatch(/evaluateLocationRisk/i)
    expect(deliver.indexOf('const locationRisk')).toBeGreaterThan(deliver.indexOf("const { data: claimed }"))
  })

  it('records approximate, warning-labelled evidence and never blocks completion', () => {
    expect(deliver).toMatch(/eventType: 'location_inconsistency'/i)
    expect(deliver).toMatch(/outcome: 'observed_only'/i)
    expect(deliver).toMatch(/Math\.round\(currentLatitude \* 1000\) \/ 1000/i)
    expect(deliver).toMatch(/do not prove identity or presence/i)
  })

  it('persists distance and validation status with the factual status event', () => {
    expect(statusEmail).toMatch(/distanceFromExpectedMeters: input\.distanceFromExpectedMeters/i)
    expect(deliver).toMatch(/validationStatus:[\s\S]*'low_accuracy'[\s\S]*'inconsistent'[\s\S]*'validated'/i)
  })

  it('allows only an accurate nearby rider handover to promote a verified place', () => {
    expect(deliver).toMatch(/gpsAccuracy <= 250/i)
    expect(deliver).toMatch(/distanceFromExpected <= trustedRadius/i)
    expect(deliver).toMatch(/promoteVerifiedPlaceFromOrder/i)
    expect(status).not.toMatch(/promoteVerifiedPlaceFromOrder/i)
  })
})
