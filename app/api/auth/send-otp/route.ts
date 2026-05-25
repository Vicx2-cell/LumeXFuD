import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { normalizePhone } from '@/lib/phone'
import { rateLimitOtpSend } from '@/lib/rate-limit'
import { sendSMS } from '@/lib/termii/sms'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { sendOtpInput } from '@/lib/validators'

export async function POST(req: NextRequest) {
  let phone: string

  try {
    const body = await req.json()
    const parsed = sendOtpInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }

    try {
      phone = normalizePhone(parsed.data.phone)
    } catch {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Rate limit: 3 per phone per hour
  const limit = await rateLimitOtpSend(phone)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many OTP requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + crypto.randomInt(900000))).padStart(6, '0')
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

  const db = createSupabaseAdmin()
  await db.from('otp_attempts').insert({
    phone,
    otp_hash: otpHash,
    expires_at: expiresAt,
    ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip'),
    user_agent: req.headers.get('user-agent'),
  })

  // Send OTP via SMS (SMS for auth, not WhatsApp — universal reach)
  try {
    await sendSMS({ to: phone, message: `Your LumeX Fud verification code is: ${otp}. Valid for 10 minutes. Do not share this code.` })
  } catch (err) {
    console.error('[send-otp] SMS failed:', err)
    // Still return success to prevent enumeration
  }

  // Always return success regardless of whether phone exists
  return NextResponse.json({ success: true, expires_in: 600 })
}
