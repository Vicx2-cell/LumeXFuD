import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { hashSecret, logPinResetAudit, validatePin } from '@/lib/pin-auth'
import { audit, superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
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
    const session = await getCurrentUser()
    if (!session || session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify caller is actually the super admin by phone match
    const superAdminPhone = process.env.SUPER_ADMIN_PHONE
    if (!superAdminPhone || session.phone !== superAdminPhone) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Super-admin force reset that mints a temp PIN — cap (5 / 15 min).
    const rl = await rateLimitGeneric(`super-resetpin:${session.userId ?? session.phone}`, 5, 900)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many reset attempts. Please wait and try again.' }, { status: 429 })
    }

    const { id: targetUserId } = await params
    const body = await req.json()
    const { user_role } = bodySchema.parse(body)

    const table = ROLE_TABLE[user_role]
    const db    = createSupabaseAdmin()

    // Verify target user exists
    const nameField = user_role === 'vendor' ? 'owner_name' : user_role === 'rider' ? 'full_name' : 'name'
    const { data: targetUser, error: fetchErr } = await db
      .from(table)
      .select(`id, phone, ${nameField}`)
      .eq('id', targetUserId)
      .maybeSingle()

    if (fetchErr || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tempPin     = generateTempPin()
    const tempPinHash = await hashSecret(tempPin)
    const now         = new Date().toISOString()

    await db.from(table).update({
      login_pin_hash:         tempPinHash,
      pin_attempts:           0,
      pin_locked_until:       null,
      pin_reset_pending:      true,
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
      actor_id:     session.phone,
      actor_role:   'super_admin',
      action:       'SUPER_ADMIN_FORCE_PIN_RESET',
      target_table: table,
      target_id:    targetUserId,
      new_value:    { pin_reset_pending: true, reset_at: now },
      ip_address:   ipAddress,
      user_agent:   userAgent,
    })

    await superAudit({
      actor_id:     session.phone,
      actor_role:   'super_admin',
      action:       'SUPER_ADMIN_FORCE_PIN_RESET',
      target_table: table,
      target_id:    targetUserId,
      new_value:    { user_role, pin_reset_pending: true, reset_at: now },
      ip_address:   ipAddress,
      user_agent:   userAgent,
    })

    return NextResponse.json({ temp_pin: tempPin })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
