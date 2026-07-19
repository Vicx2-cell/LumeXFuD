import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { createSession, setCookieOptions, type SessionRole } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone, safeNormalizePhone } from '@/lib/phone'
import { registerInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { compareSecret, findAuthUserByPhone, generateRecoveryCode, hashSecret, normalizeSecurityAnswer, validatePin } from '@/lib/pin-auth'
import { getFeature } from '@/lib/features'
import { verifyPhoneVerified, PHONE_VERIFIED_COOKIE, verifiedCookieOptions } from '@/lib/phone-verify'
import { isPhoneBlocked } from '@/lib/blocklist'
import { recordConsent, CONSENT_ACTIONS } from '@/lib/consent'

export async function POST(req: NextRequest) {
  try {
    // Feature flag: a super admin can close new sign-ups platform-wide.
    if (!(await getFeature('signups'))) {
      return NextResponse.json({ error: 'New sign-ups are currently closed.' }, { status: 503 })
    }

    // Unauthenticated endpoint — rate limit per IP (5 / hour) to curb mass
    // account creation. No-ops if Upstash is unset.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const rl = await rateLimitGeneric(`register:${ip}`, 5, 3600)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many sign-up attempts. Please try again later.' }, { status: 429 })
    }

    const body = await req.json()
    const data = registerInput.parse(body)
    if (data.pin !== data.confirm_pin) {
      return NextResponse.json({ error: 'PIN confirmation does not match' }, { status: 400 })
    }
    if (data.question_1 === data.question_2) {
      return NextResponse.json({ error: 'Security questions must be different' }, { status: 400 })
    }

    validatePin(data.pin)
    const normalizedPhone = normalizePhone(data.phone)

    // Privileged numbers must NEVER be self-registered through this public route,
    // regardless of the phone_verification flag. The super admin bootstraps via
    // login (ensureSuperAdminBootstrap) and operational admins are provisioned in
    // the super-admin panel. Without this, turning phone_verification OFF would
    // let anyone who knows SUPER_ADMIN_PHONE register it and be handed super_admin
    // below — OTP was previously the only thing preventing that.
    const privilegedPhones = new Set<string>()
    for (const raw of [process.env.SUPER_ADMIN_PHONE, process.env.ADMIN_PHONE]) {
      if (!raw) continue
      privilegedPhones.add(raw)                    // match the env value as written
      try { privilegedPhones.add(normalizePhone(raw)) } catch { /* keep raw only */ }
    }
    if (privilegedPhones.has(normalizedPhone)) {
      return NextResponse.json({ error: 'This number cannot be registered here.' }, { status: 403 })
    }

    // Banned numbers can never re-register (super-admin blocklist, migration 063).
    if (await isPhoneBlocked(normalizedPhone)) {
      return NextResponse.json({ error: 'This number cannot be registered.', blocked: true }, { status: 403 })
    }

    // Phone ownership must be proven first: /register/send-code → verify-code
    // sets a signed cookie bound to this exact number. No cookie, expired, or a
    // mismatch (they changed the number after verifying) → block.
    //
    // A super admin can disable this gate (feature: phone_verification) while OTP
    // delivery is down so onboarding isn't blocked — accounts created then have an
    // unverified phone (an accepted, reversible trade-off). Enforced server-side;
    // the client step is just UX.
    const verificationEnforced = await getFeature('phone_verification')
    if (verificationEnforced) {
      const phoneVerified = await verifyPhoneVerified(req.cookies.get(PHONE_VERIFIED_COOKIE)?.value, normalizedPhone)
      if (!phoneVerified) {
        return NextResponse.json(
          { error: 'Please verify your phone number first.', phone_unverified: true },
          { status: 403 }
        )
      }
    }

    const existing = await findAuthUserByPhone(normalizedPhone)
    if (existing) {
      return NextResponse.json({ error: 'Phone is already registered' }, { status: 409 })
    }

    const [pinHash, answer1Hash, answer2Hash] = await Promise.all([
      hashSecret(data.pin),
      hashSecret(normalizeSecurityAnswer(data.answer_1)),
      hashSecret(normalizeSecurityAnswer(data.answer_2)),
    ])
    const recoveryCode = generateRecoveryCode()
    const recoveryCodeHash = await hashSecret(recoveryCode)

    const db = createSupabaseAdmin()
    const insertData = {
      phone: normalizedPhone,
      name: data.name,
      default_delivery_address: data.default_delivery_address,
      // Stamp whether the phone was actually proven. FALSE means the account was
      // created while phone_verification was off (OTP down) — flag it for
      // re-verification once OTP returns. (migration 029)
      phone_verified: verificationEnforced,
      login_pin_hash: pinHash,
      pin_attempts: 0,
      pin_locked_until: null,
      security_question_1: data.question_1,
      security_answer_1_hash: answer1Hash,
      security_question_2: data.question_2,
      security_answer_2_hash: answer2Hash,
      recovery_code_hash: recoveryCodeHash,
      recovery_attempts: 0,
      recovery_locked_until: null,
    }

    const { data: user, error } = await db.from('customers').insert(insertData).select('id').single()
    if (error || !user) {
      return NextResponse.json({ error: 'Unable to create account' }, { status: 500 })
    }

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined

    // Attach a referral if a valid code was supplied (and the feature is on). The
    // RPC does all fraud checks server-side (code exists, not self, not already
    // referred) and is a no-op otherwise — never block sign-up on it. Non-fatal.
    if (data.referral_code && (await getFeature('referral'))) {
      db.rpc('attach_referral', {
        p_referred: user.id,
        p_code: data.referral_code,
        p_ip: ipAddress ?? null,
        p_device: userAgent ?? null,
      }).then(() => {}, () => {})
    }

    // Record the customer's acceptance of the Terms, Privacy and Refund policies at
    // sign-up against the current terms version (append-only). The UI gates account
    // creation on an explicit tick; this is the durable proof. Non-fatal.
    void recordConsent({ actorId: user.id, role: 'customer', action: CONSENT_ACTIONS.ONBOARD, ipAddress, userAgent })

    // Call number (the account `phone` IS the WhatsApp number). Both are required;
    // "same as WhatsApp" sends no call_phone, so default it to the WhatsApp number
    // — call_phone is ALWAYS stored. Separate non-fatal update so sign-up never
    // breaks on a DB where migration 074 hasn't been applied (missing column = no-op).
    const callPhone = (data.call_phone ? safeNormalizePhone(data.call_phone) : null) || normalizedPhone
    db.from('customers').update({ call_phone: callPhone }).eq('id', user.id).then(() => {}, () => {})
    // If the registering phone matches SUPER_ADMIN_PHONE, grant super_admin role.
    // (In practice the privileged-phone guard above already 403s this number, so
    // this is belt-and-braces; normalize the env value to stay format-agnostic.)
    const role: SessionRole = normalizedPhone === safeNormalizePhone(process.env.SUPER_ADMIN_PHONE) ? 'super_admin' : 'customer'
    const { token } = await createSession(user.id, normalizedPhone, role, ipAddress, userAgent)

    const res = NextResponse.json({ success: true, recovery_code: recoveryCode })
    res.cookies.set(sessionCookieName(), token, setCookieOptions(role))
    // Burn the phone-verified cookie — single use.
    res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
    return res
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? 'Invalid registration payload' }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : 'Invalid registration payload'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
