import { describe, expect, it } from 'vitest'
import { chooseRefundWebhookTarget, refundWebhookAmountKobo, type RefundWebhookCandidate } from '@/lib/paystack/webhook'

const row = (id: string, amount: number, ref: string | null = null): RefundWebhookCandidate => ({
  id,
  amount_kobo: amount,
  paystack_refund_reference: ref,
  created_at: `2026-01-01T00:00:0${id}.000Z`,
})

describe('refund webhook target selection', () => {
  it('reproduces the partial-refund bypass and refuses ambiguous transaction-only events', () => {
    const rows = [row('1', 10_000), row('2', 20_000)]
    expect(chooseRefundWebhookTarget(rows, { transaction_reference: 'tx_1' })).toEqual({
      refundId: null,
      ambiguous: true,
      reason: 'multiple_processing_refunds',
    })
  })

  it('uses provider refund reference when present', () => {
    const rows = [row('1', 10_000, 'rf_1'), row('2', 20_000, 'rf_2')]
    expect(chooseRefundWebhookTarget(rows, { transaction_reference: 'tx_1', refund_reference: 'rf_2' })).toEqual({
      refundId: '2',
      ambiguous: false,
    })
  })

  it('falls back to amount only when it identifies exactly one pending refund', () => {
    const rows = [row('1', 10_000), row('2', 20_000)]
    expect(chooseRefundWebhookTarget(rows, { transaction_reference: 'tx_1', amount: 20_000 })).toEqual({
      refundId: '2',
      ambiguous: false,
    })
    expect(chooseRefundWebhookTarget([row('1', 10_000), row('2', 10_000)], { amount: 10_000 })).toEqual({
      refundId: null,
      ambiguous: true,
      reason: 'amount_matches_multiple_refunds',
    })
  })

  it('normalizes provider refund amounts safely', () => {
    expect(refundWebhookAmountKobo({ amount: '5000' })).toBe(5000)
    expect(refundWebhookAmountKobo({ refund_amount: 6000 })).toBe(6000)
    expect(refundWebhookAmountKobo({ amount: 'bad' })).toBeNull()
    expect(refundWebhookAmountKobo({ amount: 0 })).toBeNull()
  })
})
