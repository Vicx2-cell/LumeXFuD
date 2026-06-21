import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone, maskPhone } from '@/lib/phone'
import { generateTempPin, hashSecret } from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { superAudit } from '@/lib/audit'
import { verifyPhoneVerified, PHONE_VERIFIED_COOKIE, verifiedCookieOptions } from '@/lib/phone-verify'
import { isPhoneBlocked } from '@/lib/blocklist'
import { z } from 'zod'

const createTeamInput = z.object({
  name:  z.string().min(1).max(100),
  phone: z.string().min(7).max(20),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await rateLimitGeneric(`super-team-create:${user.userId ?? user.phone}`, 20, 60)
    if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

    const body = await req.json()
    const parsed = createTeamInput.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 })
    const { name, phone } = parsed.data

    let normalized: string
    try { normalized = normalizePhone(phone) } catch { return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 }) }

    // A banned number can never be re-added — enforced directly here so it holds
    // even when phone_verification is OFF and the OTP gate below is skipped (mig 063).
    if (await isPhoneBlocked(normalized)) {
      return NextResponse.json({ error: 'This number is banned and cannot be added.' }, { status: 403 })
    }

    // Phone ownership must be proven by OTP first — the super admin sends a code to
    // the new admin's number and enters it back. The signed `phone_verified` cookie
    // is bound to THIS number + the admin_create purpose. Governed by the same
    // `phone_verification` flag as customer sign-up.
    const verificationEnforced = await getFeature('phone_verification')
    if (verificationEnforced) {
      const ok = await verifyPhoneVerified(req.cookies.get(PHONE_VERIFIED_COOKIE)?.value, normalized, 'admin_create')
      if (!ok) {
        return NextResponse.json(
          { error: 'Verify the admin’s phone number first.', phone_unverified: true },
          { status: 403 },
        )
      }
    }

    const db = createSupabaseAdmin()
    const { data: existing } = await db.from('admins').select('id').eq('phone', normalized).maybeSingle()
    if (existing) return NextResponse.json({ error: 'Admin phone already exists' }, { status: 409 })

    const tempPin = generateTempPin()
    const pinHash = await hashSecret(tempPin)

    const insert = {
      name,
      phone: normalized,
      login_pin_hash: pinHash,
      pin_reset_pending: true,
      is_active: true,
      added_by: user.userId ?? null,
    }

    const { data, error } = await db.from('admins').insert(insert).select('id').single()
    if (error || !data) return NextResponse.json({ error: 'Failed to create admin' }, { status: 500 })

    await superAudit({
      actor_id: user.phone,
      actor_role: user.role,
      action: 'admin_created',
      target_table: 'admins',
      target_id: data.id as string,
      new_value: { name, phone: maskPhone(normalized) },
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })

    const message = `Hi, your LumeX admin account is ready! Login at ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'} with your number ${normalized} and PIN: ${tempPin}. You will be asked to change your PIN on first login.`

    const res = NextResponse.json({ success: true, temp_pin: tempPin, name, phone: normalized, whatsapp_message: message })
    // Burn the phone-verified cookie — single use, so the next admin must verify afresh.
    res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
    return res
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
