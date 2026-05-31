import { NextRequest, NextResponse } from 'next/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { forgotPinSecurityAnswersInput } from '@/lib/validators'
import { compareSecret, findAuthUserByPhone, hashSecret, logPinResetAudit, normalizeSecurityAnswer, validatePin } from '@/lib/pin-auth'
import { rateLimitForgotPinQuestions } from '@/lib/rate-limit'

const LOCKOUT_ATTEMPTS = 3
const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone, answer_1, answer_2, new_pin } = forgotPinSecurityAnswersInput.parse(body)
    const normalizedPhone = phone.trim()

    const rate = await rateLimitForgotPinQuestions(normalizedPhone)
    if (!rate.success) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
    }

    const user = await findAuthUserByPhone(normalizedPhone)
    const now = new Date()
    let target = user
    if (!target) {
      await compareSecret(normalizeSecurityAnswer(answer_1), null)
      await compareSecret(normalizeSecurityAnswer(answer_2), null)
      return NextResponse.json({ error: 'Invalid information' }, { status: 400 })
    }

    const lockUntil = target.user.recovery_locked_until ? new Date(target.user.recovery_locked_until) : null
    if (lockUntil && lockUntil > now) {
      return NextResponse.json(
        { error: `Account recovery locked until ${lockUntil.toLocaleTimeString()}.` },
        { status: 423 }
      )
    }

    const answer1Valid = await compareSecret(normalizeSecurityAnswer(answer_1), target.user.security_answer_1_hash)
    const answer2Valid = await compareSecret(normalizeSecurityAnswer(answer_2), target.user.security_answer_2_hash)

    if (!answer1Valid || !answer2Valid) {
      const db = createSupabaseAdmin()
      const attempts = (target.user.recovery_attempts ?? 0) + 1
      const updates: Record<string, unknown> = { recovery_attempts: attempts }
      if (attempts >= LOCKOUT_ATTEMPTS) {
        updates.recovery_locked_until = new Date(now.getTime() + LOCKOUT_DURATION_MS).toISOString()
      }
      await db.from(target.table).update(updates).eq('id', target.user.id)
      await logPinResetAudit({
        user_id: target.user.id,
        user_role: target.role,
        reset_method: 'SECURITY_QUESTIONS',
        ip_address: req.headers.get('x-forwarded-for') ?? undefined,
        user_agent: req.headers.get('user-agent') ?? undefined,
        succeeded: false,
      })
      return NextResponse.json({ error: 'Invalid information' }, { status: 400 })
    }

    validatePin(new_pin)
    const pinHash = await hashSecret(new_pin)
    const db = createSupabaseAdmin()
    await db.from(target.table).update({
      login_pin_hash: pinHash,
      pin_attempts: 0,
      pin_locked_until: null,
      recovery_attempts: 0,
      recovery_locked_until: null,
      pin_reset_pending: false,
    }).eq('id', target.user.id)

    await logPinResetAudit({
      user_id: target.user.id,
      user_role: target.role,
      reset_method: 'SECURITY_QUESTIONS',
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
      succeeded: true,
    })

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined
    const { token } = await createSession(target.user.id, normalizedPhone, target.role, ipAddress, userAgent)
    const res = NextResponse.json({ redirect_path: target.role === 'customer' ? '/' : target.role === 'vendor' ? '/vendor-dashboard' : target.role === 'rider' ? '/rider' : target.role === 'admin' ? '/admin' : '/super-admin' })
    res.cookies.set('session', token, setCookieOptions(target.role))
    return res
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
