import type { SessionRole } from './session'

// ROUTE_POLICY is the single source of truth for every API route's auth class.
// The authz coverage test asserts that every app/api/**/route.ts file appears
// here; a new route that forgets to declare its class fails CI.

export type Policy =
  | { kind: 'role'; roles: SessionRole[] }
  | { kind: 'self' }
  | { kind: 'auth' }
  | { kind: 'public' }
  | { kind: 'cron' }
  | { kind: 'webhook' }

const SUPER: SessionRole[] = ['super_admin']
const A_S: SessionRole[] = ['admin', 'super_admin']
const VR: SessionRole[] = ['vendor', 'rider']
const VAS: SessionRole[] = ['vendor', 'admin', 'super_admin']
const RAS: SessionRole[] = ['rider', 'admin', 'super_admin']

const role = (roles: SessionRole[]): Policy => ({ kind: 'role', roles })
const map = (keys: string[], p: Policy): Record<string, Policy> =>
  Object.fromEntries(keys.map((k) => [k, p]))

export const ROUTE_POLICY: Record<string, Policy> = {
  ...map([
    'admin/feature-flags', 'admin/wallet-adjust', 'admin/block', 'admin/stats',
    'super-admin/announcement', 'super-admin/consent', 'super-admin/controls',
    'super-admin/cron-health', 'super-admin/cron-run', 'super-admin/earnings',
    'super-admin/earnings/history', 'super-admin/feature-usage', 'super-admin/features',
    'super-admin/financials', 'super-admin/lockdown', 'super-admin/pricing',
    'super-admin/premium',
    'super-admin/payments', 'super-admin/feed-reports', 'super-admin/feed-stories', 'super-admin/official-feed',
    'super-admin/revoke-sessions', 'super-admin/rewards', 'super-admin/security-health',
    'super-admin/sentinel', 'super-admin/settings', 'super-admin/super-audit',
    'super-admin/team/create', 'super-admin/users/[id]/force-reset-pin', 'super-admin/withdraw',
    'admin/whatsapp',
  ], role(SUPER)),

  ...map([
    'admin/audit', 'admin/dashboard', 'admin/orders', 'admin/disputes',
    'admin/disputes/[id]/analyze', 'admin/disputes/[id]/resolve', 'admin/face',
    'admin/kyc/queue', 'admin/live', 'admin/lodges', 'admin/lodges/[id]',
    'admin/pin-resets', 'admin/reviews', 'admin/reviews/[id]', 'admin/riders',
    'admin/riders/[id]', 'admin/riders/create', 'admin/suspend',
    'admin/users/[id]/reset-pin', 'admin/vendors', 'admin/vendors/[id]',
    'admin/vendors/create', 'admin/vendors/[id]/inspection', 'admin/verify-receipt', 'admin/wallets',
    'admin/customer-locations', 'admin/verified-places', 'admin/verified-places/[id]',
    'wallet/freeze', 'wallet/unfreeze', 'paystack/refund',
  ], role(A_S)),

  ...map([
    'wallet/withdraw', 'wallet/verify-account', 'wallet/transactions', 'wallet/set-pin',
    'wallet/save-bank', 'wallet/balance', 'wallet/banks',
  ], role(VR)),

  ...map([
    'vendor/reviews', 'vendor/menu', 'vendor/menu/[id]', 'upload/menu-image',
    'vendor-ai/daily-summary', 'vendor-ai/describe', 'ai/menu-digitize', 'forecast/vendor',
  ], role(['vendor'])),

  ...map(['rider/reviews', 'rider-ai', 'forecast/hotspots'], role(['rider'])),

  ...map([
    'customer-wallet/balance', 'customer-wallet/topup', 'customer-wallet/transactions',
    'orders/history', 'orders/[id]/dispute', 'orders/[id]/confirm', 'orders/[id]/rate',
    'feed', 'feed/drafts', 'feed/posts', 'feed/stories', 'feed/uploads', 'feed/events', 'feed/video-quota', 'feed/watch',
    'feed/videos', 'feed/stale-suggestions',
    'feed/posts/[id]/like', 'feed/posts/[id]/bookmark', 'feed/posts/[id]/repost',
    'feed/posts/[id]/reply', 'feed/posts/[id]/quote', 'feed/posts/[id]/report',
    'feed/posts/[id]/feedback', 'feed/posts/[id]/archive', 'feed/posts/[id]/restore',
    'feed/posts/[id]/retry-processing', 'feed/posts/[id]', 'feed/posts/bulk-archive', 'feed/posts/bulk-restore', 'feed/posts/bulk-delete',
    'feed/profiles/[profileId]/follow', 'feed/profiles/[profileId]/mute', 'feed/profiles/[profileId]/block',
  ], { kind: 'auth' }),

  ...map([
    'vendor/orders', 'vendors/[id]/status', 'vendors/[id]/pause', 'vendors/[id]/hours',
    'vendors/[id]/pickup-settings', 'vendors/[id]/location', 'orders/[id]/collect',
  ], role(VAS)),

  ...map([
    'rider/orders', 'riders/[id]/status', 'riders/[id]/accept',
    'orders/[id]/deliver', 'orders/[id]/delivery-photo',
  ], role(RAS)),

  ...map(['feed/cleanup/diagnostics'], role(SUPER)),

  'flyer-image': { kind: 'public' },
  'campaign/track': { kind: 'public' },

  ...map([
    'vendor/marketing/events', 'vendor/marketing/flyers', 'vendor/marketing/flyers/[id]',
    'vendor/marketing/flyers/[id]/download',
  ], { kind: 'self' }),

  ...map(['premium/plans'], { kind: 'public' }),

  ...map(['premium/subscribe'], role(['vendor'])),

  ...map(['boosts'], role(['vendor'])),

  ...map([
    'customer/addresses', 'customer/favorites', 'customer/places', 'customer/places/[id]',
    'customer/places/[id]/use', 'customer/places/photo', 'profile/image', 'customer/locations', 'customer/locations/[id]',
    'group-order/[code]', 'group-order/[code]/cancel', 'group-order/[code]/items',
    'group-order/create', 'group-order/mine',
    'orders', 'orders/[id]/cancel', 'orders/[id]/reorder', 'orders/[id]/handover-code',
    'orders/[id]/status', 'rewards', 'rewards/surprise/[id]/open', 'streak/nudge',
    'lumi', 'lumi/confirm', 'lumi/badge', 'lumi/memory', 'chow-ai', 'push/subscribe', 'notifications',
    'study/ingest', 'sponsor-wallet/topup', 'sponsor-wallet/receipt', 'launch-counter',
  ], { kind: 'self' }),

  ...map([
    'auth/account', 'auth/bank/status', 'auth/change-pin', 'auth/export', 'auth/face',
    'auth/face/status', 'auth/forgot-pin/get-questions', 'auth/forgot-pin/recovery-code',
    'auth/forgot-pin/security-answers', 'auth/google/callback', 'auth/google/start',
    'auth/tiktok/start', 'auth/tiktok/callback',
    'auth/login', 'auth/logout', 'auth/me', 'auth/otp/send', 'auth/otp/verify',
    'auth/pin/reset', 'auth/regenerate-recovery-code', 'auth/register', 'auth/remove-pin',
    'auth/setup', 'auth/social/complete', 'auth/webauthn/login-options',
    'auth/webauthn/login-verify', 'auth/webauthn/register-options', 'auth/webauthn/register-verify',
    'premium/status',
  ], { kind: 'auth' }),

  ...map([
    'cron/recalculate-vendor-scores', 'cron/release-payments', 'cron/release-scheduled',
    'cron/reset-daily-limits', 'cron/reset-weekly-leaderboard', 'cron/sentinel',
    'cron/subscription-check', 'cron/vendor-auto-cancel', 'cron/wallet-reconciliation',
    'cron/wallet-release-held', 'cron/wallet-sweep',
  ], { kind: 'cron' }),

  'paystack/webhook': { kind: 'webhook' },
  'whatsapp': { kind: 'webhook' },

  ...map(['announcement', 'applications', 'delivery-locations', 'features', 'vendors', 'vendors/[id]', 'lodges', 'settings/fees', 'orders/estimate'],
    { kind: 'public' }),
}

export function routeKey(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/.*app\/api\//, '')
    .replace(/\/route\.tsx?$/, '')
}

export function unclassifiedRoutes(keys: string[]): string[] {
  return keys.filter((k) => !(k in ROUTE_POLICY))
}
