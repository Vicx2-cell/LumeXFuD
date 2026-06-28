import type { SessionPayload, SessionRole } from './session'
import { recordSecurityEvent } from './security-events'

// Central authorization gate (FORTRESS surface #5). Replaces the ~90 hand-copied
// inline `if (!roles.includes(session.role)) 403` checks with one decision point
// that ALSO emits an authz_deny security event on every denial. Per-handler (not
// middleware): the API matcher deliberately excludes /api, and routes self-auth.

export type AuthzOk = { ok: true; session: SessionPayload }
export type AuthzDeny = { ok: false; status: 401 | 403; error: string }
export type AuthzResult = AuthzOk | AuthzDeny

/**
 * Function-level (BFLA) gate. Returns the session on success; on failure returns
 * the exact status/body the route should send — IDENTICAL codes to the old inline
 * checks (401 no session, 403 wrong role) so the access-control suite stays green.
 * A wrong-role denial writes an `authz_deny` event to the hash-chained spine.
 */
export async function requireRole(
  session: SessionPayload | null,
  roles: SessionRole[],
  surface: string,
  ctx?: { ip?: string | null },
): Promise<AuthzResult> {
  if (!session) return { ok: false, status: 401, error: 'Unauthorized' }
  if (!roles.includes(session.role)) {
    await recordSecurityEvent({
      eventType: 'authz_deny', severity: 'warn', surface,
      actorId: session.userId, actorRole: session.role, ip: ctx?.ip ?? undefined,
      detail: { needed: roles, route: surface },
    })
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, session }
}

// ─── Object-level (BOLA/IDOR) helpers — staff (admin/super) bypass, else must own ──
const isStaff = (s: SessionPayload) => s.role === 'admin' || s.role === 'super_admin'

export function canActOnVendor(s: SessionPayload, vendorId: string): boolean {
  return isStaff(s) || (s.role === 'vendor' && s.userId === vendorId)
}
export function canActOnRider(s: SessionPayload, riderId: string): boolean {
  return isStaff(s) || (s.role === 'rider' && s.userId === riderId)
}
export function canActOnCustomer(s: SessionPayload, customerId: string): boolean {
  return isStaff(s) || (s.role === 'customer' && s.userId === customerId)
}
