import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { generateTempPin, hashSecret } from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'

const createRiderInput = z.object({
  full_name: z.string().min(1).max(100).transform((s) => s.trim()),
  phone:     z.string().min(7).max(20),
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
    const { full_name, phone } = parsed.data

    let normalized: string
    try {
      normalized = normalizePhone(phone)
    } catch (err) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }

    const db = createSupabaseAdmin()
    const { data: existing } = await db.from('riders').select('id').eq('phone', normalized).maybeSingle()
    if (existing) return NextResponse.json({ error: 'Rider phone already exists' }, { status: 409 })

    const tempPin = generateTempPin()
    const pinHash = await hashSecret(tempPin)

    const insert = {
      full_name,
      // Legacy NOT NULL column in the live DB (from 000_sync) — mirror full_name.
      name: full_name,
      phone: normalized,
      login_pin_hash: pinHash,
      pin_reset_pending: true,
      is_active: true,
      added_by: user.userId ?? null,
    }

    const { data, error } = await db.from('riders').insert(insert).select('id').single()
    if (error || !data) return NextResponse.json({ error: 'Failed to create rider' }, { status: 500 })

    const message = `Hi, your LumeX Fud rider account is ready! Login at ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'} with your number ${normalized} and PIN: ${tempPin}. You will be asked to change your PIN on first login.`

    return NextResponse.json({ success: true, temp_pin: tempPin, full_name, phone: normalized, whatsapp_message: message })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
