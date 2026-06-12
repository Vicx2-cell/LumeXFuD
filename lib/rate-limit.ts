import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

function makeRatelimit(requests: number, windowSeconds: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, `${windowSeconds}s`),
  })
}

export type RateLimitResult = { success: boolean; remaining: number; reset: number }

// failClosed: when the limiter itself errors (Redis outage / bad token), should
// the request be allowed (open) or blocked (closed)? Default OPEN — a Redis blip
// must never 500 a login or payment. Pass `true` only where an unmetered request
// has a real external cost (e.g. a Termii SMS), so a blip can't drain credits.
async function check(limiter: Ratelimit | null, key: string, failClosed = false): Promise<RateLimitResult> {
  if (!limiter) {
    // Limiter unconfigured (no Upstash env). Same open/closed decision applies.
    return failClosed
      ? { success: false, remaining: 0, reset: 0 }
      : { success: true, remaining: 999, reset: 0 }
  }
  try {
    const result = await limiter.limit(key)
    return { success: result.success, remaining: result.remaining, reset: result.reset }
  } catch (err) {
    console.error(`[rate-limit] limiter error — failing ${failClosed ? 'CLOSED' : 'open'}:`, err)
    return failClosed
      ? { success: false, remaining: 0, reset: 0 }
      : { success: true, remaining: 999, reset: 0 }
  }
}

// 3 OTP sends per phone per hour. Fails CLOSED: each send costs a Termii SMS, so
// if Redis is unavailable we'd rather block (user retries) than leave the
// endpoint unmetered and burn credits.
const _otpSendLimiter = makeRatelimit(3, 3600)
export async function rateLimitOtpSend(phone: string): Promise<RateLimitResult> {
  return check(_otpSendLimiter, `otp:send:${phone}`, true)
}

// 5 OTP verify attempts per phone per 15 minutes
const _otpVerifyLimiter = makeRatelimit(5, 900)
export async function rateLimitOtpVerify(phone: string): Promise<RateLimitResult> {
  return check(_otpVerifyLimiter, `otp:verify:${phone}`)
}

// 5 PIN login attempts per phone per 30 minutes
const _pinLoginLimiter = makeRatelimit(5, 1800)
export async function rateLimitPinLogin(phone: string): Promise<RateLimitResult> {
  return check(_pinLoginLimiter, `pin:login:${phone}`)
}

// 3 forgot-PIN (security questions) attempts per phone per hour
const _forgotPinQuestionsLimiter = makeRatelimit(3, 3600)
export async function rateLimitForgotPinQuestions(phone: string): Promise<RateLimitResult> {
  return check(_forgotPinQuestionsLimiter, `forgot:questions:${phone}`)
}

// 5 get-questions lookups per IP per hour (enumeration prevention)
const _forgotPinGetQuestionsLimiter = makeRatelimit(5, 3600)
export async function rateLimitForgotPinGetQuestions(ip: string): Promise<RateLimitResult> {
  return check(_forgotPinGetQuestionsLimiter, `forgot:getq:${ip}`)
}

// 5 forgot-PIN (recovery code) attempts per phone per hour
const _forgotPinRecoveryCodeLimiter = makeRatelimit(5, 3600)
export async function rateLimitForgotPinRecoveryCode(phone: string): Promise<RateLimitResult> {
  return check(_forgotPinRecoveryCodeLimiter, `forgot:recovery:${phone}`)
}

// Generic: N requests per window (seconds).
//
// failClosed: default OPEN so a Redis blip can't 500 ordinary requests. Pass
// `true` on money-movement routes (order create, withdraw, top-up, bank change,
// refund) where an unmetered request has a real financial cost — there we'd
// rather reject (the user retries) than let a Redis outage silently disable the
// velocity cap that blunts payout drains and checkout/charge spam.
export async function rateLimitGeneric(
  key: string,
  requests: number,
  windowSeconds: number,
  failClosed = false,
): Promise<RateLimitResult> {
  const limiter = makeRatelimit(requests, windowSeconds)
  return check(limiter, key, failClosed)
}
