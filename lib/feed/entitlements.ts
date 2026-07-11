export type FeedEntitlementKey =
  | 'tiktok.connection'
  | 'premium.visibility_boost'
  | 'premium.analytics'
  | 'premium.scheduling'
  | 'premium.badge'
  | 'premium.unlimited_videos'
  | 'premium.selected_tiktok_videos'
  | 'vendor.boosts'
  | 'rider.creator_rewards'
  | 'customer.creator_rewards'
  | 'google.calendar'
  | 'google.drive'
  | 'google.gmail'

export interface EntitlementContext {
  role?: 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'
  premiumActive?: boolean
  hasOverride?: boolean
  featureEnabled?: boolean
}

const ROLE_DEFAULTS: Record<string, FeedEntitlementKey[]> = {
  vendor: ['vendor.boosts'],
  rider: ['rider.creator_rewards'],
  customer: ['customer.creator_rewards'],
  admin: ['premium.analytics'],
  super_admin: ['premium.analytics', 'premium.visibility_boost', 'premium.scheduling', 'premium.badge'],
}

export function hasEntitlement(
  entitlementKey: FeedEntitlementKey,
  ctx: EntitlementContext = {},
  granted: Iterable<FeedEntitlementKey> = [],
): boolean {
  if (ctx.featureEnabled === false) return false
  if (ctx.hasOverride) return true
  if (ctx.premiumActive) return true

  for (const key of granted) {
    if (key === entitlementKey) return true
  }

  const defaults = ctx.role ? ROLE_DEFAULTS[ctx.role] ?? [] : []
  return defaults.includes(entitlementKey)
}

export function entitlementListForRole(role: EntitlementContext['role']): FeedEntitlementKey[] {
  return role ? [...(ROLE_DEFAULTS[role] ?? [])] : []
}

