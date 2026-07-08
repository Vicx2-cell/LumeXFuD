import type { SessionRole } from './session'

// ════════════════════════════════════════════════════════════════════════════
// ROUTE_POLICY — the single source of truth for EVERY API route's authorization
// class (FORTRESS surface #5). The authz coverage test asserts that every
// app/api/**/route.ts file appears here; a new route that forgets to declare its
// class FAILS CI. This is the structural guarantee that an un-gated privileged
// route can never ship unnoticed — the #1 RLS-coverage idea applied to authz.
//
// Classes:
//   role    — strict role gate (admin panel, wallet, etc.). roles = who may call.
//   self    — authenticated; the route enforces per-row ownership / multi-role
//             logic itself (BOLA handled in-handler, e.g. orders/[id]/*).
//   auth    — auth flow, public by design (login, OTP, register, webauthn…).
//   public  — unauthenticated public read (homepage vendors, fees, banner).
//   cron    — protected by the CRON_SECRET bearer header.
//   webhook — verified by provider HMAC (Paystack).
// ════════════════════════════════════════════════════════════════════════════

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
  // ── super_admin only ──
  ...map([
    'admin/feature-flags', 'admin/wallet-adjust', 'admin/block', 'admin/stats',
    'super-admin/announcement', 'super-admin/consent', 'super-admin/controls',
    'super-admin/cron-health', 'super-admin/cron-run', 'super-admin/earnings',
    'super-admin/earnings/history', 'super-admin/feature-usage', 'super-admin/features',
    'super-admin/financials', 'super-admin/lockdown', 'super-admin/pricing',
    'super-admin/revoke-sessions', 'super-admin/rewards', 'super-admin/security-health',
    'super-admin/sentinel', 'super-admin/settings', 'super-admin/super-audit',
    'super-admin/team/create', 'super-admin/users/[id]/force-reset-pin', 'super-admin/withdraw',
    'admin/whatsapp',
  ], role(SUPER)),

  // ── admin + super_admin ──
  ...map([
    'admin/audit', 'admin/dashboard', 'admin/orders', 'admin/disputes',
    'admin/disputes/[id]/analyze', 'admin/disputes/[id]/resolve', 'admin/face',
    'admin/kyc/queue', 'admin/live', 'admin/lodges', 'admin/lodges/[id]',
    'admin/pin-resets', 'admin/reviews', 'admin/reviews/[id]', 'admin/riders',
    'admin/riders/[id]', 'admin/riders/create', 'admin/suspend',
    'admin/users/[id]/reset-pin', 'admin/vendors', 'admin/vendors/[id]',
    'admin/vendors/create', 'admin/verify-receipt', 'admin/wallets',
    'wallet/freeze', 'wallet/unfreeze', 'paystack/refund',
  ], role(A_S)),

  // ── vendor + rider (shared wallet) ──
  ...map([
    'wallet/withdraw', 'wallet/verify-account', 'wallet/transactions', 'wallet/set-pin',
    'wallet/save-bank', 'wallet/balance', 'wallet/banks',
  ], role(VR)),

  // ── vendor only ──
  ...map([
    'vendor/reviews', 'vendor/menu', 'vendor/menu/[id]', 'upload/menu-image',
    'vendor-ai/daily-summary', 'vendor-ai/describe', 'ai/menu-digitize', 'forecast/vendor',
  ], role(['vendor'])),

  // ── rider only ──
  ...map(['rider/reviews', 'rider-ai', 'forecast/hotspots'], role(['rider'])),

  // ── customer only ──
  ...map([
    'customer-wallet/balance', 'customer-wallet/topup', 'customer-wallet/transactions',
    'orders/history', 'orders/[id]/dispute', 'orders/[id]/confirm', 'orders/[id]/rate',
  ], role(['customer'])),

  // ── vendor + admin + super ──
  ...map([
    'vendor/orders', 'vendors/[id]/status', 'vendors/[id]/pause', 'vendors/[id]/hours',
    'vendors/[id]/pickup-settings', 'vendors/[id]/location', 'orders/[id]/collect',
  ], role(VAS)),

  // ── rider + admin + super ──
  ...map([
    'rider/orders', 'riders/[id]/status', 'riders/[id]/accept',
    'orders/[id]/deliver', 'orders/[id]/delivery-photo',
  ], role(RAS)),

  // ── authenticated, self-scoped (ownership / multi-role enforced in-handler) ──
  ...map([
    'customer/addresses', 'customer/favorites', 'customer/places', 'customer/places/[id]',
    'customer/places/[id]/use', 'customer/places/photo', 'profile/image',
    'group-order/[code]', 'group-order/[code]/cancel', 'group-order/[code]/items',
    'group-order/create', 'group-order/mine',
    'orders', 'orders/[id]/cancel', 'orders/[id]/reorder', 'orders/[id]/handover-code',
    'orders/[id]/status', 'rewards', 'rewards/surprise/[id]/open', 'streak/nudge',
    'lumi', 'lumi/confirm', 'lumi/badge', 'lumi/memory', 'chow-ai', 'push/subscribe', 'notifications',
    'study/ingest', 'sponsor-wallet/topup', 'sponsor-wallet/receipt', 'launch-counter',
  ], { kind: 'self' }),

  // ── auth flow (public by design) ──
  ...map([
    'auth/account', 'auth/bank/status', 'auth/change-pin', 'auth/export', 'auth/face',
    'auth/face/status', 'auth/forgot-pin/get-questions', 'auth/forgot-pin/recovery-code',
    'auth/forgot-pin/security-answers', 'auth/google/callback', 'auth/google/start',
    'auth/login', 'auth/logout', 'auth/me', 'auth/otp/send', 'auth/otp/verify',
    'auth/pin/reset', 'auth/regenerate-recovery-code', 'auth/register', 'auth/remove-pin',
    'auth/setup', 'auth/social/complete', 'auth/webauthn/login-options',
    'auth/webauthn/login-verify', 'auth/webauthn/register-options', 'auth/webauthn/register-verify',
  ], { kind: 'auth' }),

  // ── cron (CRON_SECRET bearer) ──
  ...map([
    'cron/recalculate-vendor-scores', 'cron/release-payments', 'cron/release-scheduled',
    'cron/reset-daily-limits', 'cron/reset-weekly-leaderboard', 'cron/sentinel',
    'cron/subscription-check', 'cron/vendor-auto-cancel', 'cron/wallet-reconciliation',
    'cron/wallet-release-held', 'cron/wallet-sweep',
  ], { kind: 'cron' }),

  // ── webhook (HMAC) ──
  'paystack/webhook': { kind: 'webhook' },
  'whatsapp': { kind: 'webhook' },

  // ── public read (unauthenticated) ──
  ...map(['announcement', 'features', 'vendors', 'vendors/[id]', 'lodges', 'settings/fees'],
    { kind: 'public' }),
}

/** Normalize an app/api file path to its policy key (e.g. admin/vendors/[id]). */
export function routeKey(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/.*app\/api\//, '')
    .replace(/\/route\.tsx?$/, '')
}

/** Route keys that are NOT classified in ROUTE_POLICY — the coverage gaps. */
export function unclassifiedRoutes(keys: string[]): string[] {
  return keys.filter((k) => !(k in ROUTE_POLICY))
}
