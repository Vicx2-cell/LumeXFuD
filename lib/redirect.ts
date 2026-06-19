// Post-login destination rules — shared by the auth API (server) and the auth
// UI (client) and the proxy (edge). Pure module: no Node/Next imports, safe on
// every runtime.

import type { SessionRole } from './session'

/** Where each role lands by default after authenticating. */
export const ROLE_HOME: Record<SessionRole, string> = {
  customer: '/home',
  vendor: '/vendor-dashboard',
  rider: '/rider',
  admin: '/admin',
  super_admin: '/super-admin',
}

// The dashboard "sections" each owned by exactly one role. A `?next=` that
// points into someone else's section must NEVER win over the user's own home —
// that's how a super admin / vendor / rider ends up staring at the customer
// homepage after login.
const SECTION_PREFIXES = ['/home', '/vendor-dashboard', '/rider', '/admin', '/super-admin']

/**
 * Resolve where to send a user after login.
 *
 * - No / unsafe `next` → the role's own home.
 * - `next` into a dashboard section that isn't this role's own → role home.
 * - Otherwise (shared routes like /orders, /profile, /cart, /vendor/[id],
 *   /leaderboard, …) → honor `next` so deep-links / share-links still work.
 */
export function resolvePostLoginRedirect(role: SessionRole, next: string | null | undefined): string {
  const home = ROLE_HOME[role] ?? '/home'
  // Only in-app, single-slash paths are eligible (block open-redirects).
  if (!next || !next.startsWith('/') || next.startsWith('//')) return home

  const section = SECTION_PREFIXES.find((p) => next === p || next.startsWith(p + '/'))
  if (section && section !== home) return home

  return next
}
