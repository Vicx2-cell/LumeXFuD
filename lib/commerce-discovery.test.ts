import { describe, expect, it } from 'vitest'
import { affordableItems, normalizeAffordableThresholds, recommendAddons } from './commerce-discovery'

const items = [
  { id: 'a', vendorId: 'v1', category: 'Rice', priceKobo: 90_000, isAvailable: true },
  { id: 'b', vendorId: 'v1', category: 'Rice', priceKobo: 20_000, isAvailable: true },
  { id: 'c', vendorId: 'v1', category: 'Drinks', priceKobo: 10_000, isAvailable: true },
  { id: 'd', vendorId: 'v2', category: 'Rice', priceKobo: 5_000, isAvailable: true },
  { id: 'e', vendorId: 'v1', category: 'Rice', priceKobo: 5_000, isAvailable: false },
]

describe('commerce discovery', () => {
  it('returns only real available items below the threshold', () => expect(affordableItems(items, 50_000).map((item) => item.id)).toEqual(['b', 'c', 'd']))
  it('returns at most three available same-vendor recommendations', () => expect(recommendAddons(items, items[0]).map((item) => item.id)).toEqual(['b', 'c']))
  it('accepts only four ascending integer affordable price bands', () => {
    expect(normalizeAffordableThresholds([90_000, 140_000, 190_000, 290_000])).toEqual([90_000, 140_000, 190_000, 290_000])
    expect(normalizeAffordableThresholds([100_000, 90_000, 200_000, 300_000])).toEqual([100_000, 150_000, 200_000, 300_000])
  })
})
