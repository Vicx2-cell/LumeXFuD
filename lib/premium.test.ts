import { describe, expect, it } from 'vitest'
import { resolvePremiumStatus } from './premium'

describe('premium status resolver', () => {
  it('resolves explicit free-tier defaults', () => {
    const status = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: false,
      trialsEnabled: false,
      role: 'vendor',
      profileId: 'profile-1',
      activeEntitlementKeys: [],
      entitlements: {},
    })

    expect(status.hasPremium).toBe(false)
    expect(status.entitlements['premium.video.active_limit']).toBe(60)
    expect(status.entitlements['premium.analytics.advanced']).toBe(false)
    expect(status.entitlements['premium.boost.discount_percent']).toBe(0)
  })

  it('marks an active subscription as premium and exposes benefits', () => {
    const status = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      activeEntitlementKeys: ['premium.analytics.advanced', 'premium.posts.schedule', 'premium.badge'],
      entitlements: {
        'premium.analytics.advanced': true,
        'premium.posts.schedule': true,
        'premium.badge': true,
        'premium.video.active_limit': 240,
        'premium.boost.discount_percent': 15,
      },
      premiumGranted: true,
      vendorSubscriptionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      activePlanKey: 'vendor-premium',
      activePlanVersion: 3,
    })

    expect(status.subscriptionState).toBe('active')
    expect(status.hasPremium).toBe(true)
    expect(status.activePlanKey).toBe('vendor-premium')
    expect(status.activePlanVersion).toBe(3)
    expect(status.benefits.analytics).toBe(true)
    expect(status.benefits.scheduling).toBe(true)
    expect(status.benefits.badge).toBe(true)
  })

  it('supports grace, past-due, canceled and trial states', () => {
    const grace = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      subscriptionState: 'grace_period',
      activeEntitlementKeys: ['premium.analytics.advanced'],
      entitlements: { 'premium.analytics.advanced': true },
      premiumGranted: true,
      vendorGraceEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const trial = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      subscriptionState: 'trialing',
      activeEntitlementKeys: ['premium.analytics.advanced'],
      entitlements: { 'premium.analytics.advanced': true },
      premiumGranted: true,
      trialEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const pastDue = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      subscriptionState: 'past_due',
      activeEntitlementKeys: ['premium.analytics.advanced'],
      entitlements: { 'premium.analytics.advanced': true },
      premiumGranted: true,
      vendorSubscriptionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const canceled = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      subscriptionState: 'canceled',
      activeEntitlementKeys: ['premium.analytics.advanced'],
      entitlements: { 'premium.analytics.advanced': true },
      premiumGranted: true,
      vendorSubscriptionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const expired = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      subscriptionState: 'expired',
      activeEntitlementKeys: [],
      entitlements: {},
      premiumGranted: false,
    })

    expect(grace.subscriptionState).toBe('grace_period')
    expect(trial.subscriptionState).toBe('trialing')
    expect(pastDue.subscriptionState).toBe('past_due')
    expect(canceled.subscriptionState).toBe('canceled')
    expect(expired.hasPremium).toBe(false)
  })

  it('supports global premium disabled fallback policies', () => {
    const denied = resolvePremiumStatus({
      premiumEnabled: false,
      premiumFallbackPolicy: 'deny_all_premium_features',
      newSubscriptionsEnabled: false,
      trialsEnabled: false,
      role: 'vendor',
      profileId: 'profile-1',
      activeEntitlementKeys: ['premium.analytics.advanced'],
      entitlements: { 'premium.analytics.advanced': true },
      premiumGranted: false,
    })
    const granted = resolvePremiumStatus({
      premiumEnabled: false,
      premiumFallbackPolicy: 'grant_all_premium_features',
      newSubscriptionsEnabled: false,
      trialsEnabled: false,
      role: 'vendor',
      profileId: 'profile-1',
      activeEntitlementKeys: ['premium.analytics.advanced', 'premium.posts.schedule'],
      entitlements: { 'premium.analytics.advanced': true, 'premium.posts.schedule': true },
      premiumGranted: true,
    })

    expect(denied.hasPremium).toBe(false)
    expect(granted.hasPremium).toBe(true)
  })

  it('applies explicit deny, grant and custom value overrides', () => {
    const status = resolvePremiumStatus({
      premiumEnabled: true,
      newSubscriptionsEnabled: true,
      trialsEnabled: true,
      role: 'vendor',
      profileId: 'profile-1',
      activeEntitlementKeys: ['premium.analytics.advanced'],
      entitlements: {
        'premium.analytics.advanced': false,
        'premium.boost.discount_percent': 25,
        'premium.video.active_limit': 120,
      },
      premiumGranted: true,
    })

    expect(status.entitlements['premium.analytics.advanced']).toBe(false)
    expect(status.entitlements['premium.boost.discount_percent']).toBe(25)
    expect(status.entitlements['premium.video.active_limit']).toBe(120)
  })
})
