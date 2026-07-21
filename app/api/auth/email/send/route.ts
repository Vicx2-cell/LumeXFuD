import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { normalizeEmail, sendEmail } from '@/lib/email/send-email'
import { renderEmailVerification } from '@/lib/email/templates'
import { clearEmailCode, generateEmailCode, storeEmailCode, type EmailVerifyPurpose } from '@/lib/email-verify'

export const runtime = 'nodejs'

const schema = z.object({
  email: z.string().trim().email().max(254),
  purpose: z.enum(['signup', 'application', 'admin_create', 'account_change']).default('signup'),
})

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    const email = normalizeEmail(parsed.data.email)!
    const purpose = parsed.data.purpose as EmailVerifyPurpose
    if (purpose === 'admin_create' || purpose === 'account_change') {
      const actor = await getCurrentUser()
      if (!actor || (purpose === 'admin_create' && !['admin', 'super_admin'].includes(actor.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const emailId = crypto.createHash('sha256').update(email).digest('hex').slice(0, 20)
    // Sending email has an external cost. Fail closed if the shared limiter is
    // unavailable, matching the paid OTP path instead of allowing unmetered sends.
    const limited = await rateLimitGeneric(`email-verify:${ip}:${emailId}`, 3, 10 * 60, true)
    if (!limited.success) return NextResponse.json({ error: 'Please wait before requesting another code.' }, { status: 429 })

    const code = generateEmailCode()
    await storeEmailCode(email, purpose, code)
    const template = renderEmailVerification({ code })
    const eventId = crypto.randomUUID()
    const result = await sendEmail({
      workflow: 'email_verification',
      to: email, eventId, idempotencyKey: `email-verification/${eventId}`,
      ...template,
    })
    if (result.status !== 'sent') {
      await clearEmailCode(email, purpose)
      console.error('[email.verification.send_failed]', { purpose, errorCode: result.errorCode })
      return NextResponse.json({ error: 'We could not send the verification email. Please try again.' }, { status: 502 })
    }
    return NextResponse.json({ sent: true })
  } catch {
    return NextResponse.json({ error: 'Email verification is temporarily unavailable.' }, { status: 503 })
  }
}
