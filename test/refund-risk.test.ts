import { describe, expect, it } from 'vitest'
import { evaluateRefundRisk } from '@/lib/refund-risk'

const base = {
  accountRefundCount30d: 0,
  accountRefundedKobo30d: 0,
  sameOrderPriorRefundCount: 0,
  orderTotalKobo: 10_000_000,
  requestedKobo: 1_000_000,
}

describe('cumulative refund risk', () => {
  it('does not penalize a legitimate first or full refund', () => {
    const first = evaluateRefundRisk({ ...base, requestedKobo: base.orderTotalKobo })
    expect(first.actions).toEqual(['observe'])
    expect(first.triggeredRules).toEqual([])
  })

  it('observes value alone without creating a case or freezing money', () => {
    const result = evaluateRefundRisk({ ...base, requestedKobo: 6_000_000 })
    expect(result.triggeredRules).toEqual([])
    expect(result.actions).not.toContain('create_evidence_hold')
    expect(result.actions).not.toContain('freeze_financial_operations')
  })

  it('escalates corroborated high velocity and cumulative value', () => {
    const result = evaluateRefundRisk({
      ...base, accountRefundCount30d: 6, accountRefundedKobo30d: 5_000_000,
    })
    expect(result.triggeredRules).toEqual(expect.arrayContaining([
      'refund_account_velocity_30d', 'refund_cumulative_value_30d',
    ]))
    expect(result.actions).toContain('create_evidence_hold')
    expect(result.actions).toContain('alert_security_admin')
  })

  it('records repeated split-refund attempts as order-abuse evidence', () => {
    const result = evaluateRefundRisk({ ...base, sameOrderPriorRefundCount: 3 })
    expect(result.triggeredRules).toContain('refund_partial_fragmentation')
    expect(result.actions).not.toContain('create_evidence_hold')
  })
})
