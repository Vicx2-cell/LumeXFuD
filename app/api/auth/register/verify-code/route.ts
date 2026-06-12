import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'
import { rateLimitOtpVerify } from '@/lib/rate-limit'
import { checkCode, signPhoneVerified, PHONE_VERIFIED_COOKIE, verifiedCookieOptions } from '@/lib/phone-verify'

const schema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

// POST /api/auth/register/verify-code — confirm the code, then issue the signed
// "phone_verified" cookie that /api/auth/register requires.
export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 })

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch {
    return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  // 5 verify attempts per phone / 15 min (shared limiter) — on top of the
  // per-code attempt cap inside checkCode.
  const rl = await rateLimitOtpVerify(phone)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
  }

  const result = await checkCode(phone, parsed.data.code)
  if (result !== 'ok') {
    const map: Record<typeof result, { msg: string; status: number }> = {
      expired:     { msg: 'Code expired or not found. Request a new one.', status: 400 },
      mismatch:    { msg: 'Incorrect code. Please try again.', status: 400 },
      too_many:    { msg: 'Too many incorrect attempts. Request a new code.', status: 429 },
      unavailable: { msg: 'Verification is temporarily unavailable. Try again later.', status: 503 },
    }
    const { msg, status } = map[result]
    return NextResponse.json({ error: msg }, { status })
  }

  const token = await signPhoneVerified(phone)
  const res = NextResponse.json({ verified: true })
  res.cookies.set(PHONE_VERIFIED_COOKIE, token, verifiedCookieOptions())
  return res
}
