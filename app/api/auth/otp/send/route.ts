import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Redis } from '@upstash/redis'
import { normalizePhone } from '@/lib/phone'
import { sendOtp } from '@/lib/sendchamp'
import { findAuthUserByPhone } from '@/lib/pin-auth'
import { getFeature } from '@/lib/features'
import { getCurrentUser } from '@/lib/session'
import { isPhoneBlocked } from '@/lib/blocklist'
import { maskPhone } from '@/lib/phone'
import { rateLimitGeneric, rateLimitOtpSend } from '@/lib/rate-limit'
import { recordSecurityEvent } from '@/lib/security-events'
import { evaluateRisk } from '@/lib/risk-engine'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

// Sendchamp's verification/create can take several seconds from Vercel's region;
// give the function headroom beyond the fetch timeout.
export const maxDuration = 30
export const runtime = 'nodejs'

// purpose=signup -> must NOT already have an account; purpose=reset -> must HAVE
// one; purpose=admin_create -> an admin/super-admin provisioning a vendor/rider/
// admin (no existence gate; the target account doesn't exist yet).
const schema = z.object({
  phone: z.string().min(7).max(20),
  purpose: z.enum(['signup', 'reset', 'admin_create', 'application']).default('signup'),
})

const COOLDOWN_SECONDS = 60
const REF_TTL_SECONDS = 600

// Stored server-side at otp_ref:<phone> so the client can't claim a different
// purpose at confirm time than it requested here.
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

// POST /api/auth/otp/send - send a 6-digit OTP over WhatsApp (Sendchamp).
export async function POST(req: NextRequest) {
  const requestContext = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) =>
    applyRequestContext(NextResponse.json(body, init), requestContext)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const eventContext = {
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
    route: req.nextUrl.pathname,
    method: req.method,
  }
  try {
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'Invalid request' }, { status: 400 }) }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return json({ error: 'Enter a valid phone number' }, { status: 400 })
    const { purpose } = parsed.data

    // admin_create is only for an authenticated admin/super-admin provisioning a
    // vendor/rider/admin - guard it before anything else so it can't be used as an
    // open OTP relay to arbitrary numbers.
    if (purpose === 'admin_create') {
      const actor = await getCurrentUser()
      if (!actor || !['admin', 'super_admin'].includes(actor.role)) {
        return json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // OTP delivery is governed by the super-admin `phone_verification` flag.
    if (!(await getFeature('phone_verification'))) {
      return json(
        { error: 'Phone verification is temporarily unavailable.', verification_disabled: true },
        { status: 503 },
      )
    }

    // Sign-ups can be closed platform-wide. (Reset/admin_create must keep working even then.)
    if (purpose === 'signup' && !(await getFeature('signups'))) {
      return json({ error: 'New sign-ups are currently closed.' }, { status: 503 })
    }

    let phone: string
    try { phone = normalizePhone(parsed.data.phone) } catch {
      return json({ error: 'Enter a valid phone number' }, { status: 400 })
    }

    // Banned numbers get no OTP - covers signup re-registration AND an admin trying
    // to re-provision a banned number (admin_create). (super-admin blocklist, mig 063)
    if (await isPhoneBlocked(phone)) {
      return json({ error: 'This number is not permitted.', blocked: true }, { status: 403 })
    }

    // Layer the paid-provider cap by phone and by network. The network limit is
    // deliberately roomy for campus NATs; a single weak network indicator can
    // throttle this action but never suspend an account.
    const [phoneLimit, networkLimit] = await Promise.all([
      rateLimitOtpSend(phone),
      rateLimitGeneric(`otp:send:ip:${ip}`, 60, 3600, true),
    ])
    if (!phoneLimit.success || !networkLimit.success) {
      const risk = evaluateRisk([{
        code: phoneLimit.success ? 'otp_network_velocity' : 'otp_phone_velocity',
        category: phoneLimit.success ? 'bot' : 'authentication',
        weight: 35,
        confidence: phoneLimit.success ? 0.7 : 0.9,
        strength: 'moderate',
      }])
      await recordSecurityEvent({
        eventType: 'ratelimit_hit', severity: 'warn', surface: 'otp_send',
        ...eventContext, outcome: 'rate_limited',
        detail: { purpose, risk },
      })
      return json({ error: 'Too many requests. Please wait and try again.' }, { status: 429 })
    }

    // Existence gate, keyed on purpose. admin_create/application skip it: the
    // applicant may already have another customer account on the same number.
    if (purpose === 'signup' || purpose === 'reset') {
      const existing = await findAuthUserByPhone(phone)
      if (purpose === 'signup' && existing) {
        return json(
          { error: 'This number is already registered. Please log in or reset your PIN.', already_registered: true },
          { status: 409 },
        )
      }
      if (purpose === 'reset' && !existing) {
        return json(
          { error: 'No account found for this number. Please sign up instead.' },
          { status: 404 },
        )
      }
    }

    let redis: Redis
    try { redis = getRedis() } catch {
      return json({ error: 'Verification is temporarily unavailable. Please try again later.' }, { status: 503 })
    }

    // 60s per-phone cooldown.
    const cdKey = `otp_cd:${phone}`
    if (await redis.get(cdKey)) {
      const risk = evaluateRisk([{
        code: 'otp_resend_cooldown', category: 'authentication', weight: 25,
        confidence: 0.8, strength: 'moderate',
      }])
      await recordSecurityEvent({
        eventType: 'ratelimit_hit', severity: 'warn', surface: 'otp_send',
        ...eventContext, outcome: 'rate_limited', detail: { purpose, risk },
      })
      return json({ error: 'Please wait a moment before requesting another code.' }, { status: 429 })
    }

    const result = await sendOtp(phone)
    if (!result.ok) {
      console.error('[otp/send] sendchamp rejected send', { phone: maskPhone(phone), reason: result.error, purpose })
      await recordSecurityEvent({
        eventType: 'otp_fail', severity: 'warn', surface: 'otp_send',
        ...eventContext, outcome: 'provider_rejected', detail: { purpose },
      })
      return json(
        { error: result.error || 'Could not send the code. Check the number and try again.' },
        { status: 502 },
      )
    }
    if (!result.reference) {
      console.error('[otp/send] sendchamp send missing reference', { phone: maskPhone(phone), purpose })
      await recordSecurityEvent({
        eventType: 'otp_fail', severity: 'warn', surface: 'otp_send',
        ...eventContext, outcome: 'provider_invalid_response', detail: { purpose },
      })
      return json({ error: 'Verification service did not return a code reference. Please try again.' }, { status: 502 })
    }

    const stored: StoredRef = { reference: result.reference, purpose }
    await redis.set(`otp_ref:${phone}`, stored, { ex: REF_TTL_SECONDS })
    await redis.set(cdKey, '1', { ex: COOLDOWN_SECONDS })

    await recordSecurityEvent({
      eventType: 'otp_sent', severity: 'info', surface: 'otp_send',
      ...eventContext, outcome: 'sent', detail: { purpose },
    })
    return json({ message: 'OTP sent' })
  } catch (error) {
    console.error('[otp/send] unexpected error', error)
    return json({ error: 'Verification is temporarily unavailable. Please try again later.' }, { status: 500 })
  }
}
