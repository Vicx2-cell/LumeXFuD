import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { checkEmailCode, EMAIL_VERIFIED_COOKIE, emailVerifiedCookieOptions, signEmailVerified } from '@/lib/email-verify'
import { normalizeEmail } from '@/lib/email/send-email'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  purpose: z.enum(['signup', 'application', 'admin_create', 'account_change']).default('signup'),
})

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
    const email = normalizeEmail(parsed.data.email)!
    const limited = await rateLimitGeneric(`email-verify-attempt:${email}`, 5, 15 * 60)
    if (!limited.success) return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
    const result = await checkEmailCode(email, parsed.data.purpose, parsed.data.code)
    if (result !== 'ok') {
      const error = result === 'too_many' ? 'Too many incorrect attempts. Request a new code.' : result === 'unavailable' ? 'Email verification is temporarily unavailable.' : 'Incorrect or expired code.'
      return NextResponse.json({ error }, { status: result === 'unavailable' ? 503 : 400 })
    }
    const token = await signEmailVerified(email, parsed.data.purpose)
    const response = NextResponse.json({ verified: true })
    response.cookies.set(EMAIL_VERIFIED_COOKIE, token, emailVerifiedCookieOptions())
    return response
  } catch {
    return NextResponse.json({ error: 'Email verification is temporarily unavailable.' }, { status: 503 })
  }
}
