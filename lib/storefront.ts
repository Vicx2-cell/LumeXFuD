import { slugify } from './seo/slug'

export const RESERVED_STORE_SLUGS = new Set([
  'admin',
  'api',
  'auth',
  'cart',
  'checkout',
  'dashboard',
  'feed',
  'group',
  'help',
  'login',
  'logout',
  'order',
  'orders',
  'profile',
  'rider',
  'settings',
  'store',
  'support',
  'vendor',
  'vendors',
  'wallet',
])

export function normalizeStoreSlug(input: string): string {
  let decoded = input ?? ''
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    decoded = ''
  }
  return slugify(decoded).slice(0, 120)
}

export function isReservedStoreSlug(slug: string): boolean {
  return RESERVED_STORE_SLUGS.has(normalizeStoreSlug(slug))
}

export function storePath(slug: string): string {
  return `/store/${normalizeStoreSlug(slug)}`
}
