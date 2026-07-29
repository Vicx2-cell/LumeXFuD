import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone, maskPhone, safeNormalizePhone } from '@/lib/phone'
import { generateTempPin, hashSecret } from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { isPhoneBlocked } from '@/lib/blocklist'
import { z } from 'zod'

const createRiderInput = z.object({
  full_name:         z.string().min(1).max(100).transform((s) => s.trim()),
  email:             z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone:             z.string().min(7).max(20),
  call_phone:        z.string().min(7).max(20).optional(),
  id_verified:       z.boolean().optional(),
  vehicle_inspected: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await rateLimitGeneric(`admin-rider-create:${user.userId ?? user.phone}`, 20, 60)
    if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

    const body = await req.json()
    const parsed = createRiderInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 })
    }
    const { full_name, email, phone, call_phone, id_verified, vehicle_inspected } = parsed.data
    let normalized: string
    try {
      normalized = normalizePhone(phone)
    } catch {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }

    // Admin-assisted creation never impersonates the applicant by completing
    // their OTP/email challenge. Contact ownership is attested during the
    // separate, audited inspection checklist before activation.
    if (await isPhoneBlocked(normalized)) {
      return NextResponse.json({ error: 'This number is banned and cannot be added.' }, { status: 403 })
    }

    const db = createSupabaseAdmin()
    const { data: existing } = await db.from('riders').select('id').eq('phone', normalized).maybeSingle()
    if (existing) return NextResponse.json({ error: 'Rider phone already exists' }, { status: 409 })
    const { data: existingEmail } = await db.from('riders').select('id').ilike('email', email).maybeSingle()
    if (existingEmail) return NextResponse.json({ error: 'Rider email already exists' }, { status: 409 })

    const tempPin = generateTempPin()
    const pinHash = await hashSecret(tempPin)
    const insert = {
      full_name,
      // Legacy NOT NULL column in the live DB (from 000_sync) — mirror full_name.
      name: full_name,
      email,
      email_verified: false,
      email_verified_at: null,
      phone: normalized,
      login_pin_hash: pinHash,
      pin_reset_pending: true,
      whatsapp_verified: false,
      is_active: false,
      approval_state: 'pending_review',
      verification_status: 'unverified',
      id_verified: id_verified ?? false,
      vehicle_inspected: vehicle_inspected ?? false,
      approved_at: null,
      approved_by: null,
      added_by: user.userId ?? null,
    }

    const { data, error } = await db.from('riders').insert(insert).select('id').single()
    if (error || !data) return NextResponse.json({ error: 'Failed to create rider' }, { status: 500 })

    // Call number (migration 074) — defaults to the WhatsApp number when not given.
    // Separate non-fatal update so creation never breaks pre-074 (missing col = no-op).
    const callNormalized = (call_phone ? safeNormalizePhone(call_phone) : null) || normalized
    db.from('riders').update({ call_phone: callNormalized }).eq('id', data.id).then(() => {}, () => {})

    await audit({
      actor_id: user.phone,
      actor_role: user.role,
      action: 'rider_created',
      target_table: 'riders',
      target_id: data.id as string,
      new_value: { full_name, phone: maskPhone(normalized) },
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })

    const message = `Hi, your LumeX Fud rider account is ready! Login at ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'} with your number ${normalized} and PIN: ${tempPin}. You will be asked to change your PIN on first login.`

    const res = NextResponse.json({ success: true, temp_pin: tempPin, full_name, phone: normalized, whatsapp_message: message })
    return res
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
