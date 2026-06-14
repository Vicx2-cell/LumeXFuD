import { describe, it, expect } from 'vitest'
import { estimateOrderPrepMinutes, prepRangeLabel } from './prep-time'

describe('estimateOrderPrepMinutes', () => {
  it('returns the vendor base for an empty cart', () => {
    expect(estimateOrderPrepMinutes([], 25)).toBe(25)
  })

  it('uses the longest dish (parallel kitchen), not the sum', () => {
    const items = [{ prepTimeMinutes: 20 }, { prepTimeMinutes: 1 }, { prepTimeMinutes: 8 }]
    expect(estimateOrderPrepMinutes(items, 25)).toBe(20) // not 29
  })

  it('falls back to the vendor base for blank items only', () => {
    // blank item inherits base 25; explicit 12 is lower → longest is the base 25.
    expect(estimateOrderPrepMinutes([{ prepTimeMinutes: null }, { prepTimeMinutes: 12 }], 25)).toBe(25)
    // all explicit and below base → the longest explicit one wins (the good's time).
    expect(estimateOrderPrepMinutes([{ prepTimeMinutes: 5 }, { prepTimeMinutes: 12 }], 25)).toBe(12)
  })

  it('clamps out-of-range / bad values to 1..180', () => {
    expect(estimateOrderPrepMinutes([{ prepTimeMinutes: 999 }], 25)).toBe(180)
    expect(estimateOrderPrepMinutes([{ prepTimeMinutes: 0 }], 25)).toBe(1)
    expect(estimateOrderPrepMinutes([{ prepTimeMinutes: 19.6 }], 25)).toBe(20) // rounds
  })
})

describe('prepRangeLabel', () => {
  it('formats prep + transit window', () => {
    expect(prepRangeLabel(20)).toBe('20–30 min')
    expect(prepRangeLabel(15, 5)).toBe('15–20 min')
  })
})
