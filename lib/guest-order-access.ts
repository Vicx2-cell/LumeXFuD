import { createHash, randomBytes } from 'crypto'

export const GUEST_ORDER_COOKIE_PREFIX = 'lx_guest_order_'

export function createGuestOrderToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hashGuestOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isValidGuestOrderToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,80}$/.test(token)
}

export function guestOrderCookieName(orderNumber: string): string {
  return `${GUEST_ORDER_COOKIE_PREFIX}${orderNumber.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

export function guestOrderNumberFromCookieName(cookieName: string): string | null {
  if (!cookieName.startsWith(GUEST_ORDER_COOKIE_PREFIX)) return null
  const orderNumber = cookieName.slice(GUEST_ORDER_COOKIE_PREFIX.length)
  return /^[A-Za-z0-9-]{3,80}$/.test(orderNumber) ? orderNumber : null
}
