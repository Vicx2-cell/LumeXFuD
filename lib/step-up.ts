import { findAuthUserById, compareSecret } from './pin-auth'
import { createSupabaseAdmin } from './supabase/server'
import type { SessionPayload } from './session'

// Step-up (re-authentication) for high-value money actions — CLAUDE.md rule #28:
// "Admin actions over ₦50,000 require re-authentication." A valid session is not
// enough; the actor must re-prove presence by re-entering their 6-digit login PIN
// at action time. This blunts a hijacked admin/super-admin session: a stolen
// cookie alone can no longer move ≥ ₦50k.
//
// The check reuses the login PIN hash + the same pin_attempts / pin_locked_until
// lockout columns, so brute-forcing the step-up also trips the login lockout.

export const STEP_UP_THRESHOLD_KOBO = 5_000_000 // ₦50,000

export type StepUpResult = { ok: true } | { ok: false; status: number; error: string }

const PIN_LOCKOUT_MINUTES = 30

/** Verify a fresh login-PIN re-entry for the session's own account. */
export async function verifyStepUp(session: SessionPayload, pin: unknown): Promise<StepUpResult> {
  if (!session.userId) return { ok: false, status: 401, error: 'Re-authentication required.' }
  if (typeof pin !== 'string' || !/^[0-9]{6}$/.test(pin)) {
    return { ok: false, status: 401, error: 'Enter your 6-digit login PIN to confirm this action.' }
  }

  const found = await findAuthUserById(session.role, session.userId)
  if (!found) return { ok: false, status: 401, error: 'Re-authentication failed.' }
  const { user, table } = found

  // Reuse the login lockout — a locked account can't step up either.
  if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
    return { ok: false, status: 429, error: 'Too many incorrect PIN attempts. Try again later.' }
  }

  const match = await compareSecret(pin, user.login_pin_hash)
  const db = createSupabaseAdmin()

  if (!match) {
    const attempts = (user.pin_attempts ?? 0) + 1
    const updates: Record<string, unknown> = { pin_attempts: attempts }
    if (attempts >= 5) updates.pin_locked_until = new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000).toISOString()
    await db.from(table).update(updates).eq('id', user.id)
    return { ok: false, status: 401, error: 'Incorrect PIN.' }
  }

  // Success — clear any partial attempt count.
  await db.from(table).update({ pin_attempts: 0, pin_locked_until: null }).eq('id', user.id)
  return { ok: true }
}

/**
 * Require step-up ONLY when the (absolute) amount meets the rule-#28 threshold.
 * Below the threshold this is a no-op (`ok: true`) so small actions are unaffected.
 */
export async function requireStepUpForAmount(
  session: SessionPayload,
  amountKobo: number,
  pin: unknown,
): Promise<StepUpResult> {
  if (Math.abs(amountKobo) < STEP_UP_THRESHOLD_KOBO) return { ok: true }
  return verifyStepUp(session, pin)
}
