import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createSession, setCookieOptions, type SessionRole } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { getRoleRedirect } from '@/lib/pin-auth'
import { normalizePhone } from '@/lib/phone'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { verifyPhoneVerified, PHONE_VERIFIED_COOKIE, verifiedCookieOptions } from '@/lib/phone-verify'
import { verifySocialPending, SOCIAL_PENDING_COOKIE, shortCookieOptions } from '@/lib/google-oauth'
import { isPhoneBlocked } from '@/lib/blocklist'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  phone: z.string().min(7).max(20),
  default_delivery_address: z.string().trim().min(5, 'Enter your usual delivery location').max(200),
})

// GET /api/auth/social/complete
// Lets the /auth/complete page confirm the pending Google session is still alive
// and prefill the name. Returns only non-sensitive display fields.
export async function GET(req: NextRequest) {
  const pending = await verifySocialPending(req.cookies.get(SOCIAL_PENDING_COOKIE)?.value)
  if (!pending) {
    return NextResponse.json({ error: 'expired' }, { status: 401 })
  }
  return NextResponse.json({ name: pending.name ?? '', email: pending.email ?? '' })
}

// POST /api/auth/social/complete
// Finishes a Google sign-up: a verified Google identity (social_pending cookie)
// plus a phone the user just proved they own (phone_verified cookie) becomes a
// real, phone-keyed customer — the same shape a phone sign-up produces.
export async function POST(req: NextRequest) {
  try {
    if (!(await getFeature('google_login'))) {
      return NextResponse.json({ error: 'Google sign-in is currently unavailable.' }, { status: 503 })
    }
    if (!(await getFeature('signups'))) {
      return NextResponse.json({ error: 'New sign-ups are currently closed.' }, { status: 503 })
    }

    // The proven Google identity. No cookie / expired → start over.
    const pending = await verifySocialPending(req.cookies.get(SOCIAL_PENDING_COOKIE)?.value)
    if (!pending) {
      return NextResponse.json({ error: 'Your sign-in session expired. Please start again.', restart: true }, { status: 401 })
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const rl = await rateLimitGeneric(`social-complete:${ip}`, 5, 3600)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
    }

    const body = await req.json()
    const { name, phone, default_delivery_address } = schema.parse(body)

    let normalizedPhone: string
    try {
      normalizedPhone = normalizePhone(phone)
    } catch {
      return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
    }

    // Privileged numbers can NEVER be self-registered (mirrors /api/auth/register).
    const privilegedPhones = new Set<string>()
    for (const raw of [process.env.SUPER_ADMIN_PHONE, process.env.ADMIN_PHONE]) {
      if (!raw) continue
      privilegedPhones.add(raw)
      try { privilegedPhones.add(normalizePhone(raw)) } catch { /* keep raw only */ }
    }
    if (privilegedPhones.has(normalizedPhone)) {
      return NextResponse.json({ error: 'This number cannot be registered here.' }, { status: 403 })
    }

    // Banned numbers can never re-register (super-admin blocklist, migration 063).
    if (await isPhoneBlocked(normalizedPhone)) {
      return NextResponse.json({ error: 'This number cannot be registered.', blocked: true }, { status: 403 })
    }

    // Phone ownership: when the phone_verification flag is on (OTP working), the
    // user must have proven this exact number via /api/auth/otp/verify,
    // which set the signed phone_verified cookie. Same trade-off as /register:
    // off = accounts created with an unverified phone.
    const verificationEnforced = await getFeature('phone_verification')
    if (verificationEnforced) {
      const ok = await verifyPhoneVerified(req.cookies.get(PHONE_VERIFIED_COOKIE)?.value, normalizedPhone)
      if (!ok) {
        return NextResponse.json(
          { error: 'Please verify your phone number first.', phone_unverified: true },
          { status: 403 }
        )
      }
    }

    const db = createSupabaseAdmin()
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined
    const role: SessionRole = 'customer'

    // The Google email may already belong to another account — let the partial
    // unique index guard it, but only attach the email when it's free so a
    // collision can't block sign-up.
    let emailToStore: string | null = pending.email
    if (emailToStore) {
      const { data: emailOwner } = await db
        .from('customers')
        .select('id')
        .ilike('email', emailToStore)
        .is('deleted_at', null)
        .maybeSingle()
      if (emailOwner) emailToStore = null // already linked elsewhere — don't duplicate
    }

    // ── Existing customer with this phone → link Google, log in. ──
    // They proved BOTH the phone (OTP) and the Google identity, so linking is safe.
    const { data: byPhone } = await db
      .from('customers')
      .select('id, google_sub, email, suspended_until, suspend_reason')
      .eq('phone', normalizedPhone)
      .is('deleted_at', null)
      .maybeSingle()
    const existing = byPhone as
      | { id: string; google_sub?: string | null; email?: string | null; suspended_until?: string | null; suspend_reason?: string | null }
      | null

    if (existing) {
      // Linking Google to an EXISTING account is only safe when the user proved
      // they own this phone via OTP just now (verificationEnforced ⇒ the
      // phone_verified cookie was already validated above). If phone
      // verification is off (OTP down), we have NO proof of ownership — refuse
      // to attach Google to someone else's account and send them to log in.
      if (!verificationEnforced) {
        return NextResponse.json(
          { error: 'This number already has an account. Please log in.', already_registered: true },
          { status: 409 },
        )
      }
      if (existing.suspended_until && new Date(existing.suspended_until).getTime() > Date.now()) {
        return NextResponse.json(
          { error: existing.suspend_reason ? `Account suspended: ${existing.suspend_reason}` : 'Your account has been suspended. Contact support.' },
          { status: 403 },
        )
      }
      const updates: Record<string, unknown> = {}
      if (!existing.google_sub) updates.google_sub = pending.sub
      if (!existing.email && emailToStore) {
        updates.email = emailToStore
        updates.email_verified = pending.emailVerified
      }
      if (Object.keys(updates).length > 0) {
        await db.from('customers').update(updates).eq('id', existing.id)
      }

      const { token } = await createSession(existing.id, normalizedPhone, role, ipAddress, userAgent)
      const res = NextResponse.json({ role, redirect_path: getRoleRedirect(role), linked: true })
      res.cookies.set(sessionCookieName(), token, setCookieOptions(role))
      res.cookies.set(SOCIAL_PENDING_COOKIE, '', shortCookieOptions(0))
      res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
      return res
    }

    // ── Brand-new account. ──
    const { data: user, error } = await db
      .from('customers')
      .insert({
        phone: normalizedPhone,
        name,
        default_delivery_address,
        phone_verified: verificationEnforced,
        email: emailToStore,
        email_verified: emailToStore ? pending.emailVerified : false,
        google_sub: pending.sub,
        // No login PIN: Google IS their sign-in. They can add a phone+PIN login
        // later from the profile if they want one.
        login_pin_hash: null,
        pin_attempts: 0,
        pin_locked_until: null,
        recovery_attempts: 0,
        recovery_locked_until: null,
      })
      .select('id')
      .single()

    if (error || !user) {
      // Most likely a race on the google_sub/email unique index.
      return NextResponse.json({ error: 'Unable to create account. Please try again.' }, { status: 500 })
    }

    const { token } = await createSession(user.id, normalizedPhone, role, ipAddress, userAgent)
    const res = NextResponse.json({ role, redirect_path: getRoleRedirect(role) })
    res.cookies.set('session', token, setCookieOptions(role))
    res.cookies.set(SOCIAL_PENDING_COOKIE, '', shortCookieOptions(0))
    res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
    return res
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid details' }, { status: 400 })
    }
    console.error('[auth/social/complete] error', error)
    return NextResponse.json({ error: 'Unable to complete sign-up' }, { status: 400 })
  }
}
