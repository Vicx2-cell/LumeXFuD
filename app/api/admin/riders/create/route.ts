import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { generateTempPin, hashSecret } from '@/lib/pin-auth'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { full_name, phone } = body
    if (!full_name || !phone) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

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
