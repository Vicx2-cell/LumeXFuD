import { describe, expect, it } from 'vitest'
import { evaluateAdminAccessRisk, privilegedApiRoles } from '@/lib/admin-access-risk'

describe('privileged API access policy', () => {
  it('classifies admin, super-admin, and sensitive financial APIs', () => {
    expect(privilegedApiRoles('/api/super-admin/security-incidents')).toEqual(['super_admin'])
    expect(privilegedApiRoles('/api/admin/feature-flags')).toEqual(['super_admin'])
    expect(privilegedApiRoles('/api/admin/block/')).toEqual(['super_admin'])
    expect(privilegedApiRoles('/api/admin/wallet-adjust')).toEqual(['super_admin'])
    expect(privilegedApiRoles('/api/admin/vendors')).toEqual(['admin', 'super_admin'])
    expect(privilegedApiRoles('/api/paystack/refund')).toEqual(['admin', 'super_admin'])
    expect(privilegedApiRoles('/api/orders')).toBeNull()
  })

  it('does not block or accuse on IP/user-agent indicators alone', () => {
    const risk = evaluateAdminAccessRisk({ sessionIpChanged: true, userAgentChanged: true })
    expect(risk.actions).toEqual(['observe'])
    expect(risk.score).toBeLessThan(20)
  })

  it('treats a wrong-role privileged probe as an authorization signal', () => {
    const risk = evaluateAdminAccessRisk({ wrongRole: true })
    expect(risk.triggeredRules).toContain('privileged_route_wrong_role')
    expect(risk.actions).toContain('require_reauthentication')
    expect(risk.actions).not.toContain('freeze_financial_operations')
  })
})
