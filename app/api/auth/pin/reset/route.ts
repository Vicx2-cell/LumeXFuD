import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import {
  PHONE_VERIFIED_COOKIE,
  verifyPhoneVerified,
  verifiedCookieOptions,
} from '@/lib/phone-verify'
import {
  findAuthUserByPhone,
  validatePin,
  hashSecret,
  logPinResetAudit,
  getRoleRedirect,
} from '@/lib/pin-auth'
import { rateLimitOtpVerify } from '@/lib/rate-limit'

const schema = z.object({
  phone: z.string().min(7).max(20),
  new_pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
})

// POST /api/auth/pin/reset — set a new login PIN after a reset-scoped phone
// verification. Requires the phone_verified cookie issued by /api/auth/otp/verify
// for purpose=reset; consumes it one-time on success.
export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid 6-digit PIN' }, { status: 400 })

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch {
    return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  const rl = await rateLimitOtpVerify(phone)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
  }

  // Gate on the reset-scoped phone_verified cookie. A signup-scoped cookie won't
  // satisfy expectedPurpose='reset'.
  const cookieOk = await verifyPhoneVerified(
    req.cookies.get(PHONE_VERIFIED_COOKIE)?.value,
    phone,
    'reset',
  )
  if (!cookieOk) {
    return NextResponse.json({ error: 'Please verify your phone before resetting your PIN.' }, { status: 401 })
  }

  const target = await findAuthUserByPhone(phone)
  if (!target) {
    return NextResponse.json({ error: 'No account found for this number.' }, { status: 404 })
  }

  // Reuse the platform PIN policy + hashing — never reinvent it.
  try {
    validatePin(parsed.data.new_pin)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Choose a stronger PIN' }, { status: 400 })
  }
  const pinHash = await hashSecret(parsed.data.new_pin)

  const db = createSupabaseAdmin()
  await db.from(target.table).update({
    login_pin_hash: pinHash,
    pin_attempts: 0,
    pin_locked_until: null,
    pin_reset_pending: false,
  }).eq('id', target.user.id)

  await logPinResetAudit({
    user_id: target.user.id,
    user_role: target.role,
    reset_method: 'OTP',
    ip_address: req.headers.get('x-forwarded-for')?.split(',')[0].trim(),
    user_agent: req.headers.get('user-agent') ?? undefined,
    succeeded: true,
  })

  // Log them straight in (matches the other reset flows), then burn the
  // phone_verified cookie so it can't be replayed.
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
  const userAgent = req.headers.get('user-agent') ?? undefined
  const { token } = await createSession(target.user.id, target.user.phone, target.role, ipAddress, userAgent)

  const res = NextResponse.json({ redirect_path: getRoleRedirect(target.role) })
  res.cookies.set(sessionCookieName(), token, setCookieOptions(target.role))
  res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
  return res
}
