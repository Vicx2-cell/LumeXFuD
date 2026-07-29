import { describe, expect, it } from 'vitest'
import { parseDeliveryEstimate } from './delivery-estimate-response'

const valid = {
  distanceKm: 1.25,
  serviceFeeKobo: 10_000,
  deliveryFeeKobo: 20_000,
  activeSurchargeTotalKobo: 0,
}

describe('parseDeliveryEstimate', () => {
  it('accepts a complete finite non-negative estimate', () => {
    expect(parseDeliveryEstimate(valid)).toEqual(valid)
  })

  it('rejects a missing distance instead of allowing a toFixed crash', () => {
    expect(parseDeliveryEstimate({ ...valid, distanceKm: undefined })).toBeNull()
  })

  it('rejects string, NaN, and infinite money values', () => {
    expect(parseDeliveryEstimate({ ...valid, deliveryFeeKobo: '20000' })).toBeNull()
    expect(parseDeliveryEstimate({ ...valid, serviceFeeKobo: Number.NaN })).toBeNull()
    expect(parseDeliveryEstimate({ ...valid, activeSurchargeTotalKobo: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('rejects negative provider values', () => {
    expect(parseDeliveryEstimate({ ...valid, deliveryFeeKobo: -1 })).toBeNull()
  })
})
