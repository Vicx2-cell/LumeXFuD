import { describe, expect, it } from 'vitest'
import { computeDeliveryPriceEstimate, haversineDistanceMeters, type DeliveryPricingConfig } from './delivery-pricing'

const basePricing: DeliveryPricingConfig = {
  cityId: 'city-1',
  zoneId: 'zone-1',
  platformMarkup: 25_000,
  bikeFee: 50000,
  doorFee: 100000,
  riderCutBike: 40000,
  riderCutDoor: 80000,
  platformCutBike: 10000,
  platformCutDoor: 20000,
  pricingMode: 'DISTANCE',
  baseDistanceMeters: 2000,
  distanceIncrementMeters: 2000,
  bikeIncrementFee: 15000,
  doorIncrementFee: 20000,
  bikeIncrementRiderFee: 10000,
  doorIncrementRiderFee: 12000,
  maxDeliveryDistanceMeters: 12000,
  vendorDeliveryRadiusMeters: 12000,
  rules: [],
}

describe('computeDeliveryPriceEstimate', () => {
  it('keeps the base fee inside the base distance', () => {
    const estimate = computeDeliveryPriceEstimate({
      pricing: basePricing,
      deliveryType: 'BIKE',
      distanceMeters: 1800,
    })

    expect(estimate.segmentCount).toBe(0)
    expect(estimate.deliveryFeeKobo).toBe(50_000)
    expect(estimate.riderTotalCutKobo).toBe(40_000)
  })

  it('adds the increment fee for each started segment after the base distance', () => {
    const estimate = computeDeliveryPriceEstimate({
      pricing: basePricing,
      deliveryType: 'BIKE',
      distanceMeters: 4500,
    })

    expect(estimate.segmentCount).toBe(2)
    expect(estimate.distanceSurchargeKobo).toBe(30_000)
    expect(estimate.deliveryFeeKobo).toBe(80_000)
    expect(estimate.riderDistanceBonusKobo).toBe(20_000)
  })

  it('applies enabled dynamic rules to both the customer fee and rider earnings', () => {
    const estimate = computeDeliveryPriceEstimate({
      pricing: {
        ...basePricing,
        rules: [{
          id: 'rule-1',
          name: 'Lunch rush',
          startTime: '12:00',
          endTime: '15:00',
          daysOfWeek: [],
          weatherTrigger: null,
          customerAdjustmentKind: 'FIXED',
          customerAdjustmentValue: 10000,
          riderBonusKind: 'FIXED',
          riderBonusValue: 7000,
          priority: 10,
          enabled: true,
        }],
      },
      deliveryType: 'DOOR',
      distanceMeters: 1000,
      now: new Date('2026-07-09T12:30:00+01:00'),
    })

    expect(estimate.activeSurchargeTotalKobo).toBe(10_000)
    expect(estimate.deliveryFeeKobo).toBe(110_000)
    expect(estimate.riderRuleBonusKobo).toBe(7_000)
    expect(estimate.riderTotalCutKobo).toBe(87_000)
  })
})

describe('haversineDistanceMeters', () => {
  it('returns zero for identical coordinates', () => {
    expect(haversineDistanceMeters({ lat: 5.0, lng: 7.0 }, { lat: 5.0, lng: 7.0 })).toBe(0)
  })
})
