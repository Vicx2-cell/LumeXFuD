import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { changePinLoginInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { compareSecret, findAuthUserByPhone, hashSecret, logPinResetAudit, validatePin } from '@/lib/pin-auth'

export async function POST(req: NextRequest) {
  try {
    const userSession = await getCurrentUser()
    if (!userSession) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Rate limit PIN-change attempts per phone (5 / 15 min) — current_pin is a
    // secret being guessed here. No-ops if Upstash is unset.
    const rl = await rateLimitGeneric(`change-pin:${userSession.phone}`, 5, 900)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
    }

    const body = await req.json()
    const { current_pin, new_pin } = changePinLoginInput.parse(body)
    validatePin(new_pin)

    const user = await findAuthUserByPhone(userSession.phone)
    if (!user || !user.user.login_pin_hash) {
      return NextResponse.json({ error: 'Invalid current PIN' }, { status: 400 })
    }

    const currentMatches = await compareSecret(current_pin, user.user.login_pin_hash)
    if (!currentMatches) {
      return NextResponse.json({ error: 'Invalid current PIN' }, { status: 400 })
    }

    const pinHash = await hashSecret(new_pin)
    const db = createSupabaseAdmin()
    await db.from(user.table).update({
      login_pin_hash: pinHash,
      pin_attempts: 0,
      pin_locked_until: null,
    }).eq('id', user.user.id)

    await logPinResetAudit({
      user_id: user.user.id,
      user_role: user.role,
      reset_method: 'CHANGE_PIN',
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
      succeeded: true,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? 'Invalid request' }, { status: 400 })
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
