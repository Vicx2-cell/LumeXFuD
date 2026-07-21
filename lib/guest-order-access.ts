import { createHash, randomBytes } from 'crypto'

export function createGuestOrderToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hashGuestOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isValidGuestOrderToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,80}$/.test(token)
}

