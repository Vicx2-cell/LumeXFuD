import { describe, expect, it } from 'vitest'
import { entitlementListForRole, hasEntitlement } from './entitlements'

describe('feed entitlements', () => {
  it('grants role defaults without premium', () => {
    expect(hasEntitlement('vendor.boosts', { role: 'vendor' })).toBe(true)
    expect(hasEntitlement('premium.analytics', { role: 'vendor' })).toBe(false)
  })

  it('honours premium and explicit overrides', () => {
    expect(hasEntitlement('premium.analytics', { role: 'customer', premiumActive: true })).toBe(true)
    expect(hasEntitlement('google.drive', { role: 'customer', hasOverride: true })).toBe(true)
  })

  it('returns the configured defaults for a role', () => {
    expect(entitlementListForRole('rider')).toContain('rider.creator_rewards')
  })
})

