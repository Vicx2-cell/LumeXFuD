import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Redis } from '@upstash/redis'
import { normalizePhone } from '@/lib/phone'
import { sendOtp } from '@/lib/sendchamp'
import { findAuthUserByPhone } from '@/lib/pin-auth'
import { getFeature } from '@/lib/features'
import { rateLimitOtpSend } from '@/lib/rate-limit'
import { getCurrentUser } from '@/lib/session'
import { isPhoneBlocked } from '@/lib/blocklist'

// Sendchamp's verification/create can take several seconds from Vercel's region;
// give the function headroom beyond the fetch timeout.
export const maxDuration = 30

// purpose=signup → must NOT already have an account; purpose=reset → must HAVE
// one; purpose=admin_create → an admin/super-admin provisioning a vendor/rider/
// admin (no existence gate; the target account doesn't exist yet).
const schema = z.object({
  phone: z.string().min(7).max(20),
  purpose: z.enum(['signup', 'reset', 'admin_create']).default('signup'),
})

const COOLDOWN_SECONDS = 60
const REF_TTL_SECONDS = 600

// Stored server-side at otp_ref:<phone> so the client can't claim a different
// purpose at confirm time than it requested here.
interface StoredRef {
  reference: string
  purpose: 'signup' | 'reset' | 'admin_create'
}

function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Redis not configured')
  return new Redis({ url, token })
}

// POST /api/auth/otp/send — send a 6-digit OTP over WhatsApp (Sendchamp
// Verification API). WhatsApp avoids the Nigerian MNO sender-ID / DND
// restrictions that block plain SMS.
export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  const { purpose } = parsed.data

  // admin_create is only for an authenticated admin/super-admin provisioning a
  // vendor/rider/admin — guard it before anything else so it can't be used as an
  // open OTP relay to arbitrary numbers.
  if (purpose === 'admin_create') {
    const actor = await getCurrentUser()
    if (!actor || !['admin', 'super_admin'].includes(actor.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // OTP delivery is governed by the super-admin `phone_verification` flag.
  if (!(await getFeature('phone_verification'))) {
    return NextResponse.json(
      { error: 'Phone verification is temporarily unavailable.', verification_disabled: true },
      { status: 503 },
    )
  }

  // Sign-ups can be closed platform-wide. (Reset/admin_create must keep working even then.)
  if (purpose === 'signup' && !(await getFeature('signups'))) {
    return NextResponse.json({ error: 'New sign-ups are currently closed.' }, { status: 503 })
  }

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch {
    return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  // Banned numbers get no OTP — covers signup re-registration AND an admin trying
  // to re-provision a banned number (admin_create). (super-admin blocklist, mig 063)
  if (await isPhoneBlocked(phone)) {
    return NextResponse.json({ error: 'This number is not permitted.', blocked: true }, { status: 403 })
  }

  // Existence gate, keyed on purpose. admin_create skips it: the new account
  // doesn't exist yet, and the create route does its own per-table uniqueness check.
  if (purpose !== 'admin_create') {
    const existing = await findAuthUserByPhone(phone)
    if (purpose === 'signup' && existing) {
      return NextResponse.json(
        { error: 'This number is already registered. Please log in or reset your PIN.', already_registered: true },
        { status: 409 },
      )
    }
    if (purpose === 'reset' && !existing) {
      return NextResponse.json(
        { error: 'No account found for this number. Please sign up instead.' },
        { status: 404 },
      )
    }
  }

  // Rate limit (rule #10): 3 sends per phone per hour. Fails CLOSED.
  const rl = await rateLimitOtpSend(phone)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many code requests. Please wait a while and try again.' }, { status: 429 })
  }

  let redis: Redis
  try { redis = getRedis() } catch {
    return NextResponse.json({ error: 'Verification is temporarily unavailable. Please try again later.' }, { status: 503 })
  }

  // 60s per-phone cooldown.
  const cdKey = `otp_cd:${phone}`
  if (await redis.get(cdKey)) {
    return NextResponse.json({ error: 'Please wait a moment before requesting another code.' }, { status: 429 })
  }

  const result = await sendOtp(phone)
  if (!result.ok) {
    return NextResponse.json({ error: 'Could not send the code. Check the number and try again.' }, { status: 502 })
  }

  const stored: StoredRef = { reference: result.reference, purpose }
  await redis.set(`otp_ref:${phone}`, stored, { ex: REF_TTL_SECONDS })
  await redis.set(cdKey, '1', { ex: COOLDOWN_SECONDS })

  return NextResponse.json({ message: 'OTP sent' })
}
