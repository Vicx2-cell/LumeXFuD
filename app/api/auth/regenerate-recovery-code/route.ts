import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { regenerateRecoveryCodeInput } from '@/lib/validators'
import { compareSecret, findAuthUserByPhone, generateRecoveryCode, hashSecret, logPinResetAudit } from '@/lib/pin-auth'

export async function POST(req: NextRequest) {
  try {
    const userSession = await getCurrentUser()
    if (!userSession) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await req.json()
    const { current_pin } = regenerateRecoveryCodeInput.parse(body)
    const user = await findAuthUserByPhone(userSession.phone)
    if (!user || !user.user.login_pin_hash) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
    }

    const valid = await compareSecret(current_pin, user.user.login_pin_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 })
    }

    const newRecoveryCode = generateRecoveryCode()
    const recoveryCodeHash = await hashSecret(newRecoveryCode)

    const db = createSupabaseAdmin()
    await db.from(user.table).update({
      recovery_code_hash: recoveryCodeHash,
      recovery_attempts: 0,
      recovery_locked_until: null,
    }).eq('id', user.user.id)

    await logPinResetAudit({
      user_id: user.user.id,
      user_role: user.role,
      reset_method: 'RECOVERY_CODE',
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
      succeeded: true,
    })

    return NextResponse.json({ recovery_code: newRecoveryCode })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
