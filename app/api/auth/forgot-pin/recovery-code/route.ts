import { NextRequest, NextResponse } from 'next/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { forgotPinRecoveryCodeInput } from '@/lib/validators'
import { compareSecret, findAuthUserByPhone, generateRecoveryCode, hashSecret, logPinResetAudit, normalizeRecoveryCode, validatePin } from '@/lib/pin-auth'
import { rateLimitForgotPinRecoveryCode } from '@/lib/rate-limit'
import { safeNormalizePhone } from '@/lib/phone'

const LOCKOUT_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone, recovery_code, new_pin } = forgotPinRecoveryCodeInput.parse(body)
    // Normalize to E.164 BEFORE keying the limiter (match /auth/login): otherwise
    // format variants (+234.../0.../spaces) land in separate Upstash buckets and
    // multiply the per-hour allowance against one account.
    const normalizedPhone = safeNormalizePhone(phone) ?? phone.trim()

    const rate = await rateLimitForgotPinRecoveryCode(normalizedPhone)
    if (!rate.success) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
    }

    const user = await findAuthUserByPhone(normalizedPhone)
    const now = new Date()
    if (!user) {
      await compareSecret(normalizeRecoveryCode(recovery_code), null)
      return NextResponse.json({ error: 'Invalid recovery code' }, { status: 400 })
    }

    const lockUntil = user.user.recovery_locked_until ? new Date(user.user.recovery_locked_until) : null
    if (lockUntil && lockUntil > now) {
      return NextResponse.json(
        { error: `Account recovery locked until ${lockUntil.toLocaleTimeString()}.` },
        { status: 423 }
      )
    }

    const code = normalizeRecoveryCode(recovery_code)
    const codeValid = await compareSecret(code, user.user.recovery_code_hash)
    if (!codeValid) {
      const db = createSupabaseAdmin()
      const attempts = (user.user.recovery_attempts ?? 0) + 1
      const updates: Record<string, unknown> = { recovery_attempts: attempts }
      if (attempts >= LOCKOUT_ATTEMPTS) {
        updates.recovery_locked_until = new Date(now.getTime() + LOCKOUT_DURATION_MS).toISOString()
      }
      await db.from(user.table).update(updates).eq('id', user.user.id)
      await logPinResetAudit({
        user_id: user.user.id,
        user_role: user.role,
        reset_method: 'RECOVERY_CODE',
        ip_address: req.headers.get('x-forwarded-for') ?? undefined,
        user_agent: req.headers.get('user-agent') ?? undefined,
        succeeded: false,
      })
      return NextResponse.json({ error: 'Invalid recovery code' }, { status: 400 })
    }

    validatePin(new_pin)
    const newPinHash = await hashSecret(new_pin)
    const newRecoveryCode = generateRecoveryCode()
    const newRecoveryCodeHash = await hashSecret(newRecoveryCode)

    const db = createSupabaseAdmin()
    await db.from(user.table).update({
      login_pin_hash: newPinHash,
      pin_attempts: 0,
      pin_locked_until: null,
      recovery_code_hash: newRecoveryCodeHash,
      recovery_attempts: 0,
      recovery_locked_until: null,
      pin_reset_pending: false,
    }).eq('id', user.user.id)

    await logPinResetAudit({
      user_id: user.user.id,
      user_role: user.role,
      reset_method: 'RECOVERY_CODE',
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
      succeeded: true,
    })

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined
    const { token } = await createSession(user.user.id, user.user.phone, user.role, ipAddress, userAgent)
    const res = NextResponse.json({ recovery_code: newRecoveryCode, redirect_path: user.role === 'customer' ? '/' : user.role === 'vendor' ? '/vendor-dashboard' : user.role === 'rider' ? '/rider' : user.role === 'admin' ? '/admin' : '/super-admin' })
    res.cookies.set(sessionCookieName(), token, setCookieOptions(user.role))
    return res
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
