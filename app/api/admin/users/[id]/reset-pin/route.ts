import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { hashSecret, logPinResetAudit, validatePin } from '@/lib/pin-auth'
import { audit } from '@/lib/audit'
import { z } from 'zod'

const bodySchema = z.object({
  user_role: z.enum(['customer', 'vendor', 'rider', 'admin']),
})

const ROLE_TABLE: Record<string, string> = {
  customer: 'customers',
  vendor:   'vendors',
  rider:    'riders',
  admin:    'admins',
}

const WEAK_PINS = new Set([
  '000000','111111','222222','333333','444444','555555',
  '666666','777777','888888','999999',
  '123456','654321','012345','234567','121212','123123',
  '112233','102030','246810','135791',
])

function generateTempPin(): string {
  let pin: string
  do {
    pin = String(randomInt(100000, 1000000)).padStart(6, '0')
    try { validatePin(pin) } catch { pin = '' }
  } while (!pin || WEAK_PINS.has(pin))
  return pin
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminSession = await getCurrentUser()
    if (!adminSession || (adminSession.role !== 'admin' && adminSession.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: targetUserId } = await params
    const body = await req.json()
    const { user_role } = bodySchema.parse(body)

    // Admins cannot reset other admins — only super_admin can do that
    if (user_role === 'admin' && adminSession.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only super admin can reset admin PINs' }, { status: 403 })
    }

    const table = ROLE_TABLE[user_role]
    const db    = createSupabaseAdmin()

    // Verify the target user exists
    const { data: targetUser, error: fetchErr } = await db
      .from(table)
      .select('id, phone')
      .eq('id', targetUserId)
      .maybeSingle()

    if (fetchErr || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tempPin    = generateTempPin()
    const tempPinHash = await hashSecret(tempPin)
    const now        = new Date().toISOString()

    await db.from(table).update({
      login_pin_hash:        tempPinHash,
      pin_attempts:          0,
      pin_locked_until:      null,
      pin_reset_pending:     true,
      pin_reset_requested_at: now,
    }).eq('id', targetUserId)

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined

    await logPinResetAudit({
      user_id:      targetUserId,
      user_role,
      reset_method: 'ADMIN_OVERRIDE',
      ip_address:   ipAddress,
      user_agent:   userAgent,
      succeeded:    true,
    })

    await audit({
      actor_id:     adminSession.phone,
      actor_role:   adminSession.role,
      action:       'ADMIN_PIN_RESET',
      target_table: table,
      target_id:    targetUserId,
      new_value:    { pin_reset_pending: true, reset_at: now },
      ip_address:   ipAddress,
      user_agent:   userAgent,
    })

    return NextResponse.json({ temp_pin: tempPin })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
