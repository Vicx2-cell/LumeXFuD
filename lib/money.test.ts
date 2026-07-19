import { describe, expect, it } from 'vitest'
import { formatPrice, toKobo, toNaira } from './money'

describe('money helpers', () => {
  it('formats kobo exactly once when converting to naira', () => {
    expect(formatPrice(380000)).toBe('\u20A63,800')
    expect(formatPrice(380000)).not.toBe('\u20A6380,000')
  })

  it('converts naira to kobo and back consistently', () => {
    expect(toKobo(3800)).toBe(380000)
    expect(toNaira(380000)).toBe(3800)
  })
})
