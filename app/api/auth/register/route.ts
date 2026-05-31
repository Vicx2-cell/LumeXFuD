import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { createSession, setCookieOptions, type SessionRole } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { registerInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { compareSecret, findAuthUserByPhone, generateRecoveryCode, hashSecret, normalizeSecurityAnswer, validatePin } from '@/lib/pin-auth'

export async function POST(req: NextRequest) {
  try {
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
    // If the registering phone matches SUPER_ADMIN_PHONE, grant super_admin role
    const role: SessionRole = normalizedPhone === process.env.SUPER_ADMIN_PHONE ? 'super_admin' : 'customer'
    const { token } = await createSession(user.id, normalizedPhone, role, ipAddress, userAgent)

    const res = NextResponse.json({ success: true, recovery_code: recoveryCode })
    res.cookies.set('session', token, setCookieOptions(role))
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
