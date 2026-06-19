import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'

// Phone-ownership verification used ONLY at sign-up: a 6-digit code is sent via
// WhatsApp (SMS fallback), held hashed in Redis with a short TTL, and on success
// we issue a signed, short-lived "phone_verified" cookie that /api/auth/register
// checks before creating the account. Login stays PIN-only (no OTP).

const CODE_TTL_SECONDS = 600          // code valid 10 minutes
const MAX_VERIFY_ATTEMPTS = 5         // wrong-code guesses before the code is burned
export const PHONE_VERIFIED_COOKIE = 'phone_verified'
const VERIFIED_TTL = '20m'            // window to finish the form after verifying
const VERIFIED_MAX_AGE = 20 * 60

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

function jwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET not set')
  return new TextEncoder().encode(s)
}

// Bind the hash to the phone so a leaked hash can't be replayed for another number.
function hashCode(phone: string, code: string): string {
  const key = process.env.JWT_SECRET
  if (!key) throw new Error('JWT_SECRET not set')
  return crypto.createHmac('sha256', key).update(`${phone}:${code}`).digest('hex')
}

export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

const codeKey = (phone: string) => `reg:otp:code:${phone}`
const attKey = (phone: string) => `reg:otp:att:${phone}`

/** Store a freshly generated code for a phone (overwrites any previous + resets attempts). */
export async function storeCode(phone: string, code: string): Promise<void> {
  const redis = getRedis()
  if (!redis) throw new Error('Redis not configured')
  await redis.set(codeKey(phone), hashCode(phone, code), { ex: CODE_TTL_SECONDS })
  await redis.del(attKey(phone))
}

export type VerifyResult = 'ok' | 'expired' | 'mismatch' | 'too_many' | 'unavailable'

/** Check a submitted code. Consumes the code on success; counts attempts otherwise. */
export async function checkCode(phone: string, code: string): Promise<VerifyResult> {
  const redis = getRedis()
  if (!redis) return 'unavailable'

  const stored = await redis.get<string>(codeKey(phone))
  if (!stored) return 'expired'

  // Count this attempt under the same TTL window as the code.
  const attempts = await redis.incr(attKey(phone))
  if (attempts === 1) await redis.expire(attKey(phone), CODE_TTL_SECONDS)
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    await redis.del(codeKey(phone))
    return 'too_many'
  }

  const expected = hashCode(phone, code)
  const match =
    stored.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(expected))
  if (!match) return 'mismatch'

  // Success — burn the code so it can't be reused.
  await redis.del(codeKey(phone))
  await redis.del(attKey(phone))
  return 'ok'
}

// What the verified phone is allowed to be used for. "signup" → create a new
// account via /register; "reset" → set a new login PIN via /api/auth/pin/reset;
// "admin_create" → an admin/super-admin provisioning a vendor/rider/admin account
// (the new owner reads the WhatsApp code back during onboarding).
export type VerifyPurpose = 'signup' | 'reset' | 'admin_create'

/**
 * Issue a signed token proving THIS phone was verified moments ago, scoped to a
 * single purpose. `purpose` defaults to 'signup' so existing callers (e.g.
 * /api/auth/register) keep working unchanged.
 */
export async function signPhoneVerified(phone: string, purpose: VerifyPurpose = 'signup'): Promise<string> {
  return new SignJWT({ stage: 'phone_verified', phone, purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(VERIFIED_TTL)
    .sign(jwtSecret())
}

/**
 * True only if the token is valid, unexpired, was issued for `phone`, AND was
 * scoped to `expectedPurpose` (defaults to 'signup', so /register's existing
 * call enforces signup-scoped cookies without any change there).
 */
export async function verifyPhoneVerified(
  token: string | undefined,
  phone: string,
  expectedPurpose: VerifyPurpose = 'signup',
): Promise<boolean> {
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] })
    return (
      payload.stage === 'phone_verified' &&
      payload.phone === phone &&
      payload.purpose === expectedPurpose
    )
  } catch {
    return false
  }
}

export function verifiedCookieOptions(maxAge = VERIFIED_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge,
    path: '/',
  }
}
