import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Redis } from '@upstash/redis'
import { normalizePhone } from '@/lib/phone'
import { rateLimitOtpVerify } from '@/lib/rate-limit'
import { signPhoneVerified, PHONE_VERIFIED_COOKIE, verifiedCookieOptions } from '@/lib/phone-verify'
import { confirmOtp } from '@/lib/sendchamp'

// Sendchamp's confirm can be slow from Vercel's region - give it headroom.
export const maxDuration = 30

const schema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

interface StoredRef {
  reference: string
  purpose: 'signup' | 'reset' | 'admin_create' | 'application'
}

function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Redis not configured')
  return new Redis({ url, token })
}

// POST /api/auth/otp/verify - confirm the WhatsApp OTP, then hand off to the
// existing auth by issuing the signed phone_verified cookie (scoped to the
// purpose chosen at send time). /api/auth/register consumes the signup cookie;
// /api/auth/pin/reset consumes the reset cookie.
export async function POST(req: NextRequest) {
  try {
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 })

    let phone: string
    try { phone = normalizePhone(parsed.data.phone) } catch {
      return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
    }

    // 5 verify attempts per phone / 15 min (rule #10).
    const rl = await rateLimitOtpVerify(phone)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
    }

    let redis: Redis
    try { redis = getRedis() } catch {
      return NextResponse.json({ error: 'Verification is temporarily unavailable. Try again later.' }, { status: 503 })
    }

    const refKey = `otp_ref:${phone}`
    const stored = await redis.get<StoredRef>(refKey)
    if (!stored?.reference) {
      return NextResponse.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 })
    }

    const result = await confirmOtp(stored.reference, parsed.data.code)
    if (!result.ok) {
      return NextResponse.json({ error: 'Incorrect or expired code. Please try again.' }, { status: 400 })
    }

    // Burn the reference so a code can't be reused.
    await redis.del(refKey)

    const token = await signPhoneVerified(phone, stored.purpose)
    const res = NextResponse.json({ verified: true, purpose: stored.purpose })
    res.cookies.set(PHONE_VERIFIED_COOKIE, token, verifiedCookieOptions())
    return res
  } catch (error) {
    console.error('[otp/verify] unexpected error', error)
    return NextResponse.json({ error: 'Verification is temporarily unavailable. Try again later.' }, { status: 500 })
  }
}
