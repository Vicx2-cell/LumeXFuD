import 'server-only'

import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'
import { normalizeEmail } from '@/lib/email/send-email'

const CODE_TTL_SECONDS = 10 * 60
const VERIFIED_MAX_AGE = 20 * 60
const MAX_ATTEMPTS = 5

export const EMAIL_VERIFIED_COOKIE = 'email_verified'
export type EmailVerifyPurpose = 'signup' | 'application' | 'admin_create' | 'account_change'
export type EmailCodeResult = 'ok' | 'expired' | 'mismatch' | 'too_many' | 'unavailable'

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? new Redis({ url, token }) : null
}

function secret(): string {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET not set')
  return value
}

function digest(email: string, purpose: EmailVerifyPurpose, code: string): string {
  return crypto.createHmac('sha256', secret()).update(`${purpose}:${email}:${code}`).digest('hex')
}

function emailKey(email: string, purpose: EmailVerifyPurpose): string {
  const identifier = crypto.createHmac('sha256', secret()).update(`${purpose}:${email}`).digest('hex')
  return `email:verify:${identifier}`
}

export function generateEmailCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export async function storeEmailCode(emailInput: string, purpose: EmailVerifyPurpose, code: string): Promise<void> {
  const email = normalizeEmail(emailInput)
  const redis = redisClient()
  if (!email || !redis) throw new Error('Email verification unavailable')
  await redis.set(emailKey(email, purpose), { hash: digest(email, purpose, code), attempts: 0 }, { ex: CODE_TTL_SECONDS })
}

export async function clearEmailCode(emailInput: string, purpose: EmailVerifyPurpose): Promise<void> {
  const email = normalizeEmail(emailInput)
  const redis = redisClient()
  if (email && redis) await redis.del(emailKey(email, purpose))
}

export async function checkEmailCode(emailInput: string, purpose: EmailVerifyPurpose, code: string): Promise<EmailCodeResult> {
  const email = normalizeEmail(emailInput)
  const redis = redisClient()
  if (!email || !redis) return 'unavailable'
  const key = emailKey(email, purpose)
  const stored = await redis.get<{ hash: string; attempts: number }>(key)
  if (!stored?.hash) return 'expired'
  const attempts = Number(stored.attempts ?? 0) + 1
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(key)
    return 'too_many'
  }
  const expected = digest(email, purpose, code)
  const matches = stored.hash.length === expected.length && crypto.timingSafeEqual(Buffer.from(stored.hash), Buffer.from(expected))
  if (!matches) {
    await redis.set(key, { ...stored, attempts }, { ex: CODE_TTL_SECONDS })
    return 'mismatch'
  }
  await redis.del(key)
  return 'ok'
}

export async function signEmailVerified(emailInput: string, purpose: EmailVerifyPurpose): Promise<string> {
  const email = normalizeEmail(emailInput)
  if (!email) throw new Error('Invalid email')
  return new SignJWT({ stage: 'email_verified', email, purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('20m')
    .sign(new TextEncoder().encode(secret()))
}

export async function verifyEmailVerified(token: string | undefined, emailInput: string, purpose: EmailVerifyPurpose): Promise<boolean> {
  const email = normalizeEmail(emailInput)
  if (!token || !email) return false
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret()), { algorithms: ['HS256'] })
    return payload.stage === 'email_verified' && payload.email === email && payload.purpose === purpose
  } catch {
    return false
  }
}

export function emailVerifiedCookieOptions(maxAge = VERIFIED_MAX_AGE) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, maxAge, path: '/' }
}
