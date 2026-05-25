import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { normalizePhone } from '@/lib/phone'
import { rateLimitOtpVerify } from '@/lib/rate-limit'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createSession, setCookieOptions, COOKIE_NAME, type SessionRole } from '@/lib/session'
import { constantTimeEqual } from '@/lib/security'
import { verifyOtpInput } from '@/lib/validators'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'

const REDIRECT_MAP: Record<SessionRole, string> = {
  customer:    '/',
  vendor:      '/vendor-dashboard',
  rider:       '/rider/dashboard',
  admin:       '/admin',
  super_admin: '/super-admin',
}

async function detectRole(phone: string): Promise<{ role: SessionRole; userId: string }> {
  const db = createSupabaseAdmin()

  // super_admin check first (env var)
  if (phone === process.env.SUPER_ADMIN_PHONE) {
    // Upsert admin record
    const { data } = await db
      .from('admins')
      .upsert({ phone, name: 'Super Admin', role: 'super_admin' }, { onConflict: 'phone' })
      .select('id')
      .single()
    return { role: 'super_admin', userId: data?.id ?? phone }
  }

  // admin check
  if (phone === process.env.ADMIN_PHONE) {
    const { data } = await db
      .from('admins')
      .upsert({ phone, name: 'Admin', role: 'admin' }, { onConflict: 'phone' })
      .select('id')
      .single()
    return { role: 'admin', userId: data?.id ?? phone }
  }

  // vendor check
  const { data: vendor } = await db
    .from('vendors')
    .select('id')
    .eq('phone', phone)
    .is('deleted_at', null)
    .single()
  if (vendor) return { role: 'vendor', userId: vendor.id }

  // rider check
  const { data: rider } = await db
    .from('riders')
    .select('id')
    .eq('phone', phone)
    .is('deleted_at', null)
    .single()
  if (rider) return { role: 'rider', userId: rider.id }

  // default: customer (upsert)
  const { data: customer } = await db
    .from('customers')
    .upsert({ phone }, { onConflict: 'phone' })
    .select('id')
    .single()
  return { role: 'customer', userId: customer?.id ?? phone }
}

export async function POST(req: NextRequest) {
  let phone: string
  let otp: string

  try {
    const body = await req.json()
    const parsed = verifyOtpInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }
    try {
      phone = normalizePhone(parsed.data.phone)
    } catch {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }
    otp = parsed.data.otp
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Rate limit: 5 attempts per phone per 15 minutes
  const limit = await rateLimitOtpVerify(phone)
  if (!limit.success) {
    // Send lockout notification
    void sendWhatsAppWithFallback({
      to: phone,
      message: `🔒 Your LumeX account is temporarily locked due to too many OTP attempts. Try again in 30 minutes.`,
    }).catch(() => {})
    return NextResponse.json(
      { error: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': '900' } }
    )
  }

  const db = createSupabaseAdmin()

  // Look up most recent valid OTP for this phone
  const { data: otpRecord } = await db
    .from('otp_attempts')
    .select('id, otp_hash')
    .eq('phone', phone)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!otpRecord) {
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 })
  }

  // Constant-time comparison (timing attack prevention)
  const inputHash = crypto.createHash('sha256').update(otp).digest('hex')
  const isValid = constantTimeEqual(inputHash, otpRecord.otp_hash)

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 })
  }

  // Mark OTP as used (single-use guarantee)
  await db
    .from('otp_attempts')
    .update({ used_at: new Date().toISOString() })
    .eq('id', otpRecord.id)

  // Detect role and get/create user record
  const { role, userId } = await detectRole(phone)

  // Create session
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined
  const ua = req.headers.get('user-agent') ?? undefined
  const { token } = await createSession(userId, phone, role, ip, ua)

  // Build response with httpOnly cookie
  const res = NextResponse.json({
    success: true,
    role,
    redirect_path: REDIRECT_MAP[role],
  })

  res.cookies.set(COOKIE_NAME, token, setCookieOptions(role))

  return res
}
