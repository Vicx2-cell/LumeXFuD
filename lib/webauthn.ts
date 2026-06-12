import { SignJWT, jwtVerify } from 'jose'
import type { SessionRole } from './session'

// WebAuthn (Face ID / Touch ID / platform passkey) configuration + the two
// short-lived signed cookies used during the PIN→biometric step-up flow.

export const RP_NAME = 'LumeX Fud'

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL
  if (!u) throw new Error('NEXT_PUBLIC_APP_URL not set — required for WebAuthn origin/RP ID')
  return u
}
/** Relying-Party ID = the registrable domain (hostname only, no port/scheme). */
export function getRpID(): string {
  return new URL(appUrl()).hostname
}
/** The exact origin the browser must report (scheme + host + port). */
export function getExpectedOrigin(): string {
  return new URL(appUrl()).origin
}

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET not set')
  return new TextEncoder().encode(s)
}

export const WA_CHALLENGE_COOKIE = 'wa_challenge'
export const MFA_COOKIE = 'mfa_pending'
const TTL = '5m'

// ── Single-use challenge cookie ─────────────────────────────────────────────
export interface ChallengePayload {
  type: 'reg' | 'auth'
  challenge: string
  phone: string
  userId: string
  role: SessionRole
}

export async function signChallenge(p: ChallengePayload): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret())
}

export async function verifyChallenge(token: string | undefined): Promise<ChallengePayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (payload.type !== 'reg' && payload.type !== 'auth') return null
    if (typeof payload.challenge !== 'string' || typeof payload.userId !== 'string') return null
    return payload as unknown as ChallengePayload
  } catch {
    return null
  }
}

// ── PIN-passed, biometric-pending step-up token ─────────────────────────────
export interface MfaPending {
  stage: 'mfa'
  userId: string
  role: SessionRole
  phone: string
}

export async function signMfaPending(p: Omit<MfaPending, 'stage'>): Promise<string> {
  return new SignJWT({ stage: 'mfa', ...p })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret())
}

export async function verifyMfaPending(token: string | undefined): Promise<MfaPending | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (payload.stage !== 'mfa') return null
    if (typeof payload.userId !== 'string' || typeof payload.phone !== 'string') return null
    return payload as unknown as MfaPending
  } catch {
    return null
  }
}

// ── Cookie option helpers ───────────────────────────────────────────────────
export function shortCookie(maxAge = 300) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge,
    path: '/',
  }
}
export function clearCookie() {
  return { ...shortCookie(0), maxAge: 0 }
}
