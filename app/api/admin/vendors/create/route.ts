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
    const { owner_name, shop_name, phone, category, subscription_tier } = body
    if (!owner_name || !shop_name || !phone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    let normalized: string
    try {
      normalized = normalizePhone(phone)
    } catch (err) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }

    const db = createSupabaseAdmin()
    const { data: existing } = await db.from('vendors').select('id').eq('phone', normalized).maybeSingle()
    if (existing) return NextResponse.json({ error: 'Vendor phone already exists' }, { status: 409 })

    const tempPin = generateTempPin()
    const pinHash = await hashSecret(tempPin)

    const insert = {
      owner_name,
      shop_name,
      phone: normalized,
      category: category ?? 'Other',
      subscription_tier: subscription_tier ?? 'STANDARD',
      login_pin_hash: pinHash,
      pin_reset_pending: true,
      is_active: true,
      created_by: user.userId ?? null,
    }

    const { data, error } = await db.from('vendors').insert(insert).select('id').single()
    if (error || !data) return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 })

    const message = `Hi, your LumeX Fud vendor account is ready! Login at ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'} with your number ${normalized} and PIN: ${tempPin}. You will be asked to change your PIN on first login.`

    return NextResponse.json({ success: true, temp_pin: tempPin, vendor_name: shop_name, phone: normalized, whatsapp_message: message })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
