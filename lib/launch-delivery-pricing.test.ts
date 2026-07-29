import { describe, expect, it } from 'vitest'
import { computeLaunchDeliveryQuote, estimateRoadDistanceMeters, type LaunchDeliveryPricing } from './launch-delivery-pricing'

const pricing: LaunchDeliveryPricing = {
  minimumCustomerDeliveryFeeKobo: 40_000,
  minimumRiderPayoutKobo: 30_000,
  deliveryMarginKobo: 10_000,
  customerPlatformFeeKobo: 10_000,
  vendorCommissionBps: 300,
  guestFeeKobo: 5_000,
  fuelPriceKoboPerLitre: 100_000,
  bikeEfficiencyMetresPerLitre: 40_000,
  maintenanceKoboPerKm: 2_000,
  roadDistanceMultiplierBps: 13_500,
}

describe('launch delivery pricing', () => {
  it('uses integer road-cost inputs and preserves minimum rider/customer economics', () => {
    const quote = computeLaunchDeliveryQuote({ pricing, roadDistanceMeters: 1_000, isGuest: false })
    expect(quote.fuelKobo).toBe(2_500)
    expect(quote.maintenanceKobo).toBe(2_000)
    expect(quote.riderPayoutKobo).toBe(30_000)
    expect(quote.deliveryFeeKobo).toBe(40_000)
    expect(quote.platformDeliveryMarginKobo).toBe(10_000)
  })

  it('adds the configured guest fee only for guest checkout', () => {
    expect(computeLaunchDeliveryQuote({ pricing, roadDistanceMeters: 1_000, isGuest: true }).guestFeeKobo).toBe(5_000)
  })

  it('uses the server-configured road multiplier rather than a browser distance', () => {
    expect(estimateRoadDistanceMeters(1_000, 13_500)).toBe(1_350)
  })
})
