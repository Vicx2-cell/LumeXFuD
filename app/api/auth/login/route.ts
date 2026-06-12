import { NextRequest, NextResponse } from 'next/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { loginPinInput } from '@/lib/validators'
import { compareSecret, findAuthUserByPhone, getRoleRedirect, hashSecret, AUTH_USER_COLUMNS, type AuthUserRow } from '@/lib/pin-auth'
import { rateLimitPinLogin } from '@/lib/rate-limit'
import { signMfaPending, MFA_COOKIE, shortCookie } from '@/lib/webauthn'

const LOCKOUT_MINUTES = 30

// Required env var — startup validation in lib/env.ts ensures this is set
const SUPER_ADMIN_DEFAULT_PIN = process.env.SUPER_ADMIN_DEFAULT_PIN!

async function ensureSuperAdminBootstrap(phone: string, pin: string) {
  if (phone !== process.env.SUPER_ADMIN_PHONE) return null
  if (pin !== SUPER_ADMIN_DEFAULT_PIN) return null
  const db = createSupabaseAdmin()
  // Explicit auth columns only — never select('*') (would pull bcrypt hashes
  // into memory needlessly).
  const { data: existingCustomer } = await db.from('customers').select(AUTH_USER_COLUMNS).eq('phone', phone).maybeSingle()
  if (existingCustomer) return { role: 'super_admin' as const, table: 'customers', user: existingCustomer as unknown as AuthUserRow }

  const pinHash = await hashSecret(pin)
  const { data: user, error } = await db.from('customers').insert({
    phone,
    name: 'Super Admin',
    login_pin_hash: pinHash,
    pin_attempts: 0,
    pin_locked_until: null,
    pin_reset_pending: false,
    recovery_attempts: 0,
    recovery_locked_until: null,
  }).select(AUTH_USER_COLUMNS).single()
  if (error || !user) return null
  return { role: 'super_admin' as const, table: 'customers', user: user as unknown as AuthUserRow }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone, pin } = loginPinInput.parse(body)

    // Canonicalize to E.164 BEFORE the rate-limit key. Keying on the raw input
    // would let an attacker dodge the cap by varying format (+234.../0.../spaces)
    // to land in separate Upstash buckets. normalizePhone throws on garbage —
    // treat that as a bad login rather than leaking a distinct error.
    let normalizedPhone: string
    try {
      normalizedPhone = normalizePhone(phone)
    } catch {
      return NextResponse.json({ error: 'Invalid phone or PIN' }, { status: 400 })
    }

    const limit = await rateLimitPinLogin(normalizedPhone)
    if (!limit.success) {
      const retryAt = new Date(Date.now() + limit.reset * 1000)
      return NextResponse.json(
        { error: `Too many login attempts. Try again after ${retryAt.toLocaleTimeString()}.` },
        { status: 429 }
      )
    }

    let user = await findAuthUserByPhone(normalizedPhone)
    if (!user) {
      user = await ensureSuperAdminBootstrap(normalizedPhone, pin)
    }
    if (!user) {
      // No account anywhere (customer/vendor/rider/admin). Per product decision
      // we surface this clearly so new users are guided to sign up — knowingly
      // accepting the account-enumeration trade-off this opens. Still run a dummy
      // compare to keep response timing close to the wrong-PIN path.
      await compareSecret(pin, null)
      return NextResponse.json(
        { error: "This number isn't registered yet.", unregistered: true },
        { status: 404 }
      )
    }
    if (!user.user.login_pin_hash) {
      // Account EXISTS but has no PIN set — a registered row in an unusual state.
      // Keep the generic message: it's not "unregistered" (don't push them to
      // re-register, which would collide with the existing row).
      await compareSecret(pin, null)
      return NextResponse.json({ error: 'Invalid phone or PIN' }, { status: 400 })
    }

    const lockUntil = user.user.pin_locked_until ? new Date(user.user.pin_locked_until) : null
    if (lockUntil && lockUntil > new Date()) {
      // Mirror the Upstash rate-limit response (429 + "Too many login attempts")
      // so a locked EXISTING account is indistinguishable from a throttled
      // unknown one — no account-enumeration via the lockout status/message.
      return NextResponse.json(
        { error: `Too many login attempts. Try again after ${lockUntil.toLocaleTimeString()}.` },
        { status: 429 }
      )
    }

    // The SUPER_ADMIN_DEFAULT_PIN only bootstraps the account (see
    // ensureSuperAdminBootstrap, which creates the row hashed with it). It is
    // deliberately NOT a permanent override here: once the super admin changes
    // their PIN, the default no longer logs in — closing a standing backdoor.
    const passwordMatch = await compareSecret(pin, user.user.login_pin_hash)

    if (!passwordMatch) {
      const db = createSupabaseAdmin()
      const attempts = (user.user.pin_attempts ?? 0) + 1
      const updates: Record<string, unknown> = { pin_attempts: attempts }
      if (attempts >= 5) {
        updates.pin_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
      }
      await db.from(user.table).update(updates).eq('id', user.user.id)
      return NextResponse.json({ error: 'Invalid phone or PIN' }, { status: 400 })
    }

    const db = createSupabaseAdmin()
    await db.from(user.table).update({
      pin_attempts: 0,
      pin_locked_until: null,
    }).eq('id', user.user.id)

    // ── Second factor (Face ID / Touch ID) ──────────────────────────────────
    // If this account has enrolled a passkey, the correct PIN is only step 1.
    // Issue a short-lived, signed "PIN passed" token instead of a session, and
    // require a WebAuthn assertion (see /api/auth/webauthn/login-*) before any
    // session exists. Accounts with no passkey log in with PIN alone (opt-in).
    const { data: passkeys } = await db
      .from('webauthn_credentials')
      .select('id')
      .eq('user_id', user.user.id)
      .eq('user_role', user.role)
      .limit(1)

    if (passkeys && passkeys.length > 0) {
      const mfaToken = await signMfaPending({ userId: user.user.id, role: user.role, phone: user.user.phone })
      const res = NextResponse.json({ webauthn_required: true })
      res.cookies.set(MFA_COOKIE, mfaToken, shortCookie())
      return res
    }

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined
    // Use the canonical E.164 phone stored on the user row, NOT the raw login
    // input — the JWT phone drives every downstream `.eq('phone', ...)` lookup
    // and the RLS `auth.jwt() ->> 'phone'` checks (rule #2).
    const { token } = await createSession(user.user.id, user.user.phone, user.role, ipAddress, userAgent)

    const res = NextResponse.json({
      role: user.role,
      redirect_path: getRoleRedirect(user.role),
      pin_reset_pending: user.user.pin_reset_pending ?? false,
    })
    res.cookies.set('session', token, setCookieOptions(user.role))
    return res
  } catch (error) {
    console.error('[auth/login] error', error)
    return NextResponse.json({ error: 'Invalid login payload' }, { status: 400 })
  }
}
