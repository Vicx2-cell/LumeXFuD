import type { SessionRole } from '@/lib/session'

export type FeedAuthorMode = 'self' | 'lumex'

export const FEED_POST_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

export type EditableFeedPost = {
  status: string
  published_at?: string | null
  is_archived?: boolean | null
  deleted_at?: string | null
}

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

export function canEditFeedPost(post: EditableFeedPost, now = Date.now()) {
  if (post.deleted_at || post.is_archived) return false
  if (post.status === 'draft') return true
  if (post.status !== 'published' || !post.published_at) return false
  const publishedAt = new Date(post.published_at).getTime()
  return Number.isFinite(publishedAt) && now - publishedAt <= FEED_POST_EDIT_WINDOW_MS
}

export function canAttachFeedMenuItem(item: { is_available: boolean; deleted_at?: string | null }) {
  return item.is_available && !item.deleted_at
}
