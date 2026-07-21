import { evaluateRisk, type RiskEvaluation, type RiskSignal } from './risk-engine'

export interface RefundRiskFacts {
  accountRefundCount30d: number
  accountRefundedKobo30d: number
  sameOrderPriorRefundCount: number
  orderTotalKobo: number
  requestedKobo: number
}

/**
 * Refund risk is deliberately based on cumulative, factual ledger history.
 * A first refund, a full refund, or value alone never creates an evidence hold.
 */
export function evaluateRefundRisk(facts: RefundRiskFacts): RiskEvaluation {
  const signals: RiskSignal[] = []
  const cumulativeKobo = Math.max(0, facts.accountRefundedKobo30d) + Math.max(0, facts.requestedKobo)

  if (facts.accountRefundCount30d >= 5) {
    signals.push({
      code: 'refund_account_velocity_30d', category: 'payment',
      weight: 55, confidence: 0.85, strength: 'strong', corroborated: true,
    })
  }
  if (facts.accountRefundCount30d >= 2 && cumulativeKobo >= 5_000_000) {
    signals.push({
      code: 'refund_cumulative_value_30d', category: 'payment',
      weight: 60, confidence: 0.85, strength: 'strong', corroborated: true,
    })
  }
  if (facts.sameOrderPriorRefundCount >= 3 && facts.orderTotalKobo > 0) {
    signals.push({
      code: 'refund_partial_fragmentation', category: 'order_abuse',
      weight: 45, confidence: 0.8, strength: 'moderate',
    })
  }

  return evaluateRisk(signals)
}
