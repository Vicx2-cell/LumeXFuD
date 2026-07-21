import { describe, expect, it } from 'vitest'
import { evaluateMultiAccountReferralRisk, referralCorrelationToken } from '@/lib/multi-account-risk'

describe('proportionate multi-account referral indicators', () => {
  it('creates a stable scoped token without persisting raw request metadata', () => {
    const secret = 's'.repeat(64)
    const token = referralCorrelationToken('198.51.100.1', 'Browser A', secret)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(token).toBe(referralCorrelationToken('198.51.100.1', 'Browser A', secret))
    expect(token).not.toContain('Browser A')
    expect(referralCorrelationToken('198.51.100.1', 'Browser A', 'short')).toBeNull()
  })

  it('does not correlate or penalize a shared IP alone', () => {
    const result = evaluateMultiAccountReferralRisk({
      sameReferrerTokenClaims24h: 20, hasCorrelationToken: false, sharedIpOnly: true,
    })
    expect(result.actions).toEqual(['observe'])
    expect(result.triggeredRules).toEqual([])
  })

  it('keeps the first two correlated referrals out of manual escalation', () => {
    const result = evaluateMultiAccountReferralRisk({ sameReferrerTokenClaims24h: 1, hasCorrelationToken: true })
    expect(result.actions).toEqual(['observe'])
  })

  it('signals the third correlated reward claim without permanent action', () => {
    const result = evaluateMultiAccountReferralRisk({ sameReferrerTokenClaims24h: 2, hasCorrelationToken: true })
    expect(result.triggeredRules).toEqual(expect.arrayContaining([
      'referral_same_context_cluster_24h', 'referral_reward_velocity_24h',
    ]))
    expect(result.actions as string[]).not.toContain('permanent_ban')
  })
})
