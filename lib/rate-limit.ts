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

async function check(limiter: Ratelimit | null, key: string): Promise<RateLimitResult> {
  if (!limiter) return { success: true, remaining: 999, reset: 0 }
  const result = await limiter.limit(key)
  return { success: result.success, remaining: result.remaining, reset: result.reset }
}

// 3 OTP sends per phone per hour
const _otpSendLimiter = makeRatelimit(3, 3600)
export async function rateLimitOtpSend(phone: string): Promise<RateLimitResult> {
  return check(_otpSendLimiter, `otp:send:${phone}`)
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

// Generic: N requests per window (seconds)
export async function rateLimitGeneric(key: string, requests: number, windowSeconds: number): Promise<RateLimitResult> {
  const limiter = makeRatelimit(requests, windowSeconds)
  return check(limiter, key)
}
