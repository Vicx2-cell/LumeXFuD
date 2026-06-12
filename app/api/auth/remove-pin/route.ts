import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { removePinLoginInput } from '@/lib/validators'
import { compareSecret, findAuthUserByPhone, logPinResetAudit } from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'

// POST /api/auth/remove-pin
// Removes the user's PIN (login falls back to OTP/recovery). Requires the
// current PIN to confirm. Modeled on /api/auth/change-pin.
export async function POST(req: NextRequest) {
  try {
    const userSession = await getCurrentUser()
    if (!userSession) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Confirms the current PIN to disable PIN login — cap at 5 / 15 min so this
    // can't be used to brute-force the current PIN.
    const rl = await rateLimitGeneric(`auth-removepin:${userSession.userId ?? userSession.phone}`, 5, 900)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
    }

    const body = await req.json()
    const { current_pin } = removePinLoginInput.parse(body)

    const user = await findAuthUserByPhone(userSession.phone)
    if (!user || !user.user.login_pin_hash) {
      return NextResponse.json({ error: 'Invalid current PIN' }, { status: 400 })
    }

    const currentMatches = await compareSecret(current_pin, user.user.login_pin_hash)
    if (!currentMatches) {
      return NextResponse.json({ error: 'Invalid current PIN' }, { status: 400 })
    }

    const db = createSupabaseAdmin()
    await db.from(user.table).update({
      login_pin_hash: null,
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
