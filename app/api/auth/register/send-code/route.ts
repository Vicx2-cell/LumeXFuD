import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'
import { findAuthUserByPhone } from '@/lib/pin-auth'
import { getFeature } from '@/lib/features'
import { rateLimitOtpSend } from '@/lib/rate-limit'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { generateCode, storeCode } from '@/lib/phone-verify'

const schema = z.object({ phone: z.string().min(7).max(20) })

// POST /api/auth/register/send-code — send a phone-ownership code at sign-up.
export async function POST(req: NextRequest) {
  // Same gate as /register: a super admin can close sign-ups platform-wide.
  if (!(await getFeature('signups'))) {
    return NextResponse.json({ error: 'New sign-ups are currently closed.' }, { status: 503 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch {
    return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  // Already registered → don't send a code; point them to login. (Registration
  // already reveals this via the 409 on /register, so no new enumeration here.)
  const existing = await findAuthUserByPhone(phone)
  if (existing) {
    return NextResponse.json({ error: 'This number is already registered. Please log in.', already_registered: true }, { status: 409 })
  }

  // 3 sends per phone per hour (shared OTP-send limiter).
  const rl = await rateLimitOtpSend(phone)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many code requests. Please wait a while and try again.' }, { status: 429 })
  }

  const code = generateCode()
  try {
    await storeCode(phone, code)
  } catch {
    return NextResponse.json({ error: 'Verification is temporarily unavailable. Please try again later.' }, { status: 503 })
  }

  try {
    await sendWhatsAppWithFallback({
      to: phone,
      message: `Your LumeX Fud verification code is ${code}. It expires in 10 minutes. Never share this code with anyone.`,
    })
  } catch {
    return NextResponse.json({ error: 'Could not send the code. Check the number and try again.' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
