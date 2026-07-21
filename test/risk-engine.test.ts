import { describe, expect, it } from 'vitest'
import { evaluateRisk, type RiskSignal } from '@/lib/risk-engine'

describe('category risk engine', () => {
  it('observes one weak signal without escalating or accusing', () => {
    const result = evaluateRisk([{
      code: 'location_inconsistency', category: 'device_session',
      weight: 100, confidence: 0.4, strength: 'weak',
    }])
    expect(result.score).toBeLessThan(20)
    expect(result.actions).toEqual(['observe'])
  })

  it('rate-limits repeated OTP abuse without permanent restriction', () => {
    const result = evaluateRisk([{
      code: 'otp_verify_velocity', category: 'authentication',
      weight: 40, confidence: 0.9, strength: 'moderate',
    }])
    expect(result.actions).toContain('rate_limit')
    expect(result.actions).not.toContain('restrict_sensitive_actions')
    expect(result.actions).not.toContain('freeze_financial_operations')
  })

  it('uses cross-category corroboration for graduated containment', () => {
    const signals: RiskSignal[] = [
      { code: 'payment_replay', category: 'payment', weight: 70, confidence: 0.95, strength: 'strong', corroborated: true },
      { code: 'amount_mismatch', category: 'payment', weight: 60, confidence: 0.95, strength: 'strong', corroborated: true },
      { code: 'authorization_probe', category: 'authorization', weight: 40, confidence: 0.8, strength: 'moderate' },
    ]
    const result = evaluateRisk(signals)
    expect(result.actions).toEqual(expect.arrayContaining([
      'rate_limit', 'require_reauthentication', 'revoke_session',
      'restrict_sensitive_actions', 'freeze_financial_operations',
      'create_evidence_hold', 'alert_security_admin',
    ]))
    expect(result.triggeredRules).toEqual(['payment_replay', 'amount_mismatch', 'authorization_probe'])
  })

  it('clamps malformed weights and confidence values', () => {
    const result = evaluateRisk([
      { code: 'negative', category: 'bot', weight: -10, confidence: 10, strength: 'strong' },
      { code: 'overconfident', category: 'admin', weight: 20, confidence: 10, strength: 'moderate' },
    ])
    expect(result.categoryScores.bot).toBe(0)
    expect(result.categoryScores.admin).toBe(20)
    expect(result.confidence).toBe(1)
  })
})
