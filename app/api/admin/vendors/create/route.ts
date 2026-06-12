import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { generateTempPin, hashSecret } from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'

const createVendorInput = z.object({
  owner_name:        z.string().min(1).max(100),
  shop_name:         z.string().min(1).max(100),
  phone:             z.string().min(7).max(20),
  category:          z.string().min(1).max(50).optional(),
  subscription_tier: z.string().min(1).max(20).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await rateLimitGeneric(`admin-vendor-create:${user.userId ?? user.phone}`, 20, 60)
    if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

    const body = await req.json()
    const parsed = createVendorInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 })
    }
    const { owner_name, shop_name, phone, category, subscription_tier } = parsed.data

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
      // The live DB (from 000_sync) carries legacy NOT NULL columns the current
      // schema dropped: `name` and `owner_phone`. Populate them from the new
      // fields so inserts don't fail with 23502.
      name: shop_name,
      phone: normalized,
      owner_phone: normalized,
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
