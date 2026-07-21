import { createHmac } from 'node:crypto'
import { evaluateRisk, type RiskEvaluation, type RiskSignal } from './risk-engine'

/** A scoped pseudonymous indicator, not a device fingerprint or identity claim. */
export function referralCorrelationToken(ip: string | null, userAgent: string | null, secret: string | undefined): string | null {
  if (!ip || !userAgent || !secret || secret.length < 32) return null
  return createHmac('sha256', secret)
    .update(`lumex-referral-v1\0${ip.trim()}\0${userAgent.slice(0, 300)}`)
    .digest('hex')
}

export function evaluateMultiAccountReferralRisk(facts: {
  sameReferrerTokenClaims24h: number
  hasCorrelationToken: boolean
  sharedIpOnly?: boolean
}): RiskEvaluation {
  const signals: RiskSignal[] = []
  if (facts.hasCorrelationToken && facts.sameReferrerTokenClaims24h >= 2) {
    signals.push({
      code: 'referral_same_context_cluster_24h', category: 'payment',
      weight: 55, confidence: 0.82, strength: 'strong', corroborated: true,
    })
    signals.push({
      code: 'referral_reward_velocity_24h', category: 'order_abuse',
      weight: 45, confidence: 0.78, strength: 'moderate',
    })
  }
  // Shared campus/carrier IP alone intentionally contributes no risk.
  return evaluateRisk(signals)
}
