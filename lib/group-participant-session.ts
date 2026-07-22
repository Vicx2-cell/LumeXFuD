import { createHash, randomBytes } from 'node:crypto'

export function groupParticipantCookieName(code: string): string {
  return `lx_group_${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
}

export function createGroupParticipantToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashGroupParticipantToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function groupParticipantCookieOptions(expiresAt: string) {
  const remainingSeconds = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.min(remainingSeconds, 24 * 60 * 60),
  }
}
