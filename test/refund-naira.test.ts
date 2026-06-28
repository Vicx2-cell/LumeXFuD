import { describe, it, expect } from 'vitest'
import { refundNaira } from '@/lib/paystack/webhook'

// FORTRESS surface #4 — the refund.processed notification must render the refund
// value from the canonical amount_kobo column, never NaN (the old code read the
// never-written `amount` column → Math.round(undefined/100) = NaN).
describe('refundNaira — REFUND_PROCESSED notification amount', () => {
  it('renders correct naira from amount_kobo', () => {
    expect(refundNaira(50000)).toBe(500)
    expect(refundNaira(815000)).toBe(8150)
  })
  it('never yields NaN for a missing/garbled amount (renders 0)', () => {
    expect(refundNaira(undefined)).toBe(0)
    expect(refundNaira(null)).toBe(0)
    expect(refundNaira('not-a-number')).toBe(0)
    expect(Number.isNaN(refundNaira(undefined))).toBe(false)
  })
})
