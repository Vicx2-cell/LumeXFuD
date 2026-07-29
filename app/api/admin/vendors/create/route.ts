import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone, maskPhone, safeNormalizePhone } from '@/lib/phone'
import { generateTempPin, hashSecret } from '@/lib/pin-auth'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { isPhoneBlocked } from '@/lib/blocklist'
import { z } from 'zod'

const createVendorInput = z.object({
  owner_name:        z.string().min(1).max(100),
  shop_name:         z.string().min(1).max(100),
  email:             z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone:             z.string().min(7).max(20),
  call_phone:        z.string().min(7).max(20).optional(),
  category:          z.string().min(1).max(50).optional(),
  merchant_category: z.enum(['restaurant', 'supermarket', 'pharmacy']).optional(),
  subscription_tier: z.string().min(1).max(20).optional(),
  id_verified:       z.boolean().optional(),
  site_inspected:    z.boolean().optional(),
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
    const { owner_name, shop_name, email, phone, call_phone, category, merchant_category, subscription_tier, id_verified, site_inspected } = parsed.data
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
    const { data: existing } = await db.from('vendors').select('id').eq('phone', normalized).maybeSingle()
    if (existing) return NextResponse.json({ error: 'Vendor phone already exists' }, { status: 409 })
    const { data: existingEmail } = await db.from('vendors').select('id').ilike('email', email).maybeSingle()
    if (existingEmail) return NextResponse.json({ error: 'Vendor email already exists' }, { status: 409 })

    const tempPin = generateTempPin()
    const pinHash = await hashSecret(tempPin)
    const insert = {
      owner_name,
      business_name: shop_name,
      shop_name,
      // The live DB (from 000_sync) carries legacy NOT NULL columns the current
      // schema dropped: `name` and `owner_phone`. Populate them from the new
      // fields so inserts don't fail with 23502.
      name: shop_name,
      email,
      email_verified: false,
      email_verified_at: null,
      phone: normalized,
      owner_phone: normalized,
      category: category ?? 'Other',
      merchant_category: merchant_category ?? 'restaurant',
      subscription_tier: subscription_tier ?? 'STANDARD',
      login_pin_hash: pinHash,
      pin_reset_pending: true,
      whatsapp_verified: false,
      created_by_admin: true,
      business_verified: false,
      is_active: false,
      approval_state: 'pending_review',
      verification_status: 'unverified',
      id_verified: id_verified ?? false,
      site_inspected: site_inspected ?? false,
      approved_at: null,
      approved_by: null,
      created_by: user.userId ?? null,
    }

    const { data, error } = await db.from('vendors').insert(insert).select('id').single()
    if (error || !data) return NextResponse.json({ error: 'Failed to create vendor' }, { status: 500 })

    // Call number (migration 074) — defaults to the WhatsApp number when not given.
    // Separate non-fatal update so creation never breaks pre-074 (missing col = no-op).
    const callNormalized = (call_phone ? safeNormalizePhone(call_phone) : null) || normalized
    db.from('vendors').update({ call_phone: callNormalized }).eq('id', data.id).then(() => {}, () => {})

    await audit({
      actor_id: user.phone,
      actor_role: user.role,
      action: 'vendor_created',
      target_table: 'vendors',
      target_id: data.id as string,
      new_value: { shop_name, owner_name, phone: maskPhone(normalized) },
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })

    const message = `Hi, your LumeX Fud vendor account is ready! Login at ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'} with your number ${normalized} and PIN: ${tempPin}. You will be asked to change your PIN on first login.`

    const res = NextResponse.json({ success: true, temp_pin: tempPin, vendor_name: shop_name, phone: normalized, whatsapp_message: message })
    return res
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
