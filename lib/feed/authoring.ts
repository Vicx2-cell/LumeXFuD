import type { SessionRole } from '@/lib/session'

export type FeedAuthorMode = 'self' | 'lumex'

export function canPublishAsLumex(role: SessionRole | string) {
  return role === 'admin' || role === 'super_admin'
}

export function normalizeFeedAuthorMode(role: SessionRole, requested?: FeedAuthorMode | null): FeedAuthorMode {
  if (requested === 'lumex' && canPublishAsLumex(role)) return 'lumex'
  return 'self'
}

export function feedAuthorModeLabel(mode: FeedAuthorMode) {
  return mode === 'lumex' ? 'LumeX Fud' : 'My profile'
}
