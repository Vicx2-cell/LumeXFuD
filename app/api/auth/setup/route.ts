import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { firstLoginSetupInput } from '@/lib/validators'
import {
  compareSecret,
  findAuthUserByPhone,
  generateRecoveryCode,
  getRoleRedirect,
  hashSecret,
  logPinResetAudit,
  normalizeSecurityAnswer,
  validatePin,
} from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { verifyStepUp } from '@/lib/step-up'

export async function POST(req: NextRequest) {
  try {
    const userSession = await getCurrentUser()
    if (!userSession) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Sets the PIN + security answers + recovery code — cap at 5 / 15 min per user.
    const rl = await rateLimitGeneric(`auth-setup:${userSession.userId ?? userSession.phone}`, 5, 900)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
    }

    const body = await req.json()
    const { pin, confirm_pin, question_1, answer_1, question_2, answer_2 } = firstLoginSetupInput.parse(body)

    if (pin !== confirm_pin) {
      return NextResponse.json({ error: 'PIN confirmation does not match' }, { status: 400 })
    }
    if (question_1 === question_2) {
      return NextResponse.json({ error: 'Security questions must be different' }, { status: 400 })
    }

    validatePin(pin)

    const user = await findAuthUserByPhone(userSession.phone)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // First-login setup mints the PIN + security answers + recovery code with no
    // prior credential. OUTSIDE genuine first-login (pin_reset_pending=true) this
    // same call would silently overwrite the whole recovery chain — turning a
    // stolen session into permanent owner lockout. Gate it: require the current
    // login PIN (constant-time, shared change-pin lockout) when not first-login.
    if (user.user.pin_reset_pending !== true) {
      const currentPin = (body as Record<string, unknown> | null)?.current_pin
      const stepUp = await verifyStepUp(userSession, currentPin)
      if (!stepUp.ok) {
        return NextResponse.json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
      }
    }

    if (user.user.login_pin_hash) {
      const sameAsTemp = await compareSecret(pin, user.user.login_pin_hash)
      if (sameAsTemp) {
        return NextResponse.json({ error: 'Choose a different PIN from the temporary one' }, { status: 400 })
      }
    }

    const db = createSupabaseAdmin()
    const [pinHash, answer1Hash, answer2Hash] = await Promise.all([
      hashSecret(pin),
      hashSecret(normalizeSecurityAnswer(answer_1)),
      hashSecret(normalizeSecurityAnswer(answer_2)),
    ])
    const recoveryCode = generateRecoveryCode()
    const recoveryCodeHash = await hashSecret(recoveryCode)

    await db.from(user.table).update({
      login_pin_hash: pinHash,
      pin_attempts: 0,
      pin_locked_until: null,
      security_question_1: question_1,
      security_answer_1_hash: answer1Hash,
      security_question_2: question_2,
      security_answer_2_hash: answer2Hash,
      recovery_code_hash: recoveryCodeHash,
      recovery_attempts: 0,
      recovery_locked_until: null,
      pin_reset_pending: false,
      pin_reset_requested_at: null,
    }).eq('id', user.user.id)

    await logPinResetAudit({
      user_id: user.user.id,
      user_role: userSession.role,
      reset_method: 'CHANGE_PIN',
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
      succeeded: true,
    })

    return NextResponse.json({
      recovery_code: recoveryCode,
      redirect_path: getRoleRedirect(userSession.role),
    })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
