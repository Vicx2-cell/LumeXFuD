import { describe, expect, it } from 'vitest'
import { formatDistanceKm, formatNullableNumber } from './number-format'

describe('safe nullable number formatting', () => {
  it('reproduces the production distance case without throwing', () => {
    expect(() => formatDistanceKm(undefined, 2)).not.toThrow()
    expect(formatDistanceKm(undefined, 2)).toBeNull()
    expect(formatDistanceKm(null, 2)).toBeNull()
  })

  it('does not present an unknown or invalid distance as zero', () => {
    expect(formatDistanceKm(Number.NaN)).toBeNull()
    expect(formatDistanceKm(Number.POSITIVE_INFINITY)).toBeNull()
    expect(formatDistanceKm(-1)).toBeNull()
    expect(formatDistanceKm(0)).toBe('0.00 km')
  })

  it('formats finite nullable values safely', () => {
    expect(formatNullableNumber(4.25, 1)).toBe('4.3')
    expect(formatNullableNumber(undefined, 1)).toBeNull()
  })
})
