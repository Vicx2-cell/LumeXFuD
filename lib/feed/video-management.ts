import { createSupabaseAdmin } from '@/lib/supabase/server'
import { resolveVideoQuotaFromEntitlements } from '@/lib/premium'
import { DEFAULT_VIDEO_QUOTA } from './quota'

export type FeedVideoState = 'active' | 'drafts' | 'archived' | 'processing' | 'failed'

export interface VideoManagementConfig {
  freeActiveVideoLimit: number
  premiumActiveVideoLimit: number
  premiumUnlimitedVideos: boolean
  tiktokCountsTowardQuota: boolean
  draftsCountTowardStorage: boolean
  archivedMediaRetentionDays: number
  deletedMediaRetentionDays: number
  staleSuggestionThresholdDays: number
  abandonedDraftCleanupDays: number
  maxBulkActionSize: number
  restoreRequiresAvailableSlot: boolean
  softDeleteRecoveryWindowDays: number
}

export interface VideoQuotaUsage {
  activeCount: number
  draftCount: number
  archivedCount: number
  processingCount: number
  failedCount: number
  storageBytes: number
}

export interface VideoQuotaResolution extends VideoQuotaUsage {
  limit: number
  unlimited: boolean
  remaining: number | null
  canPublish: boolean
  premiumActive: boolean
}

export interface VideoLifecycleItem {
  id: string
  caption: string | null
  post_kind: string
  status: string
  is_archived: boolean
  deleted_at: string | null
  archived_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  view_count: number
  order_count: number
  storage_bytes: number
  provider_type: string
  external_provider_ref: string | null
  related_menu_item_id: string | null
  post_media: Array<{
    id: string
    media_kind: string
    public_url: string | null
    storage_path: string | null
    provider_type: string
    external_provider_ref: string | null
    storage_bytes: number
    cleanup_state: string
    cleanup_attempts: number
  }>
}

export interface VideoSuggestion {
  postId: string
  reason: string
  evidence: Record<string, unknown>
  expectedQuotaRecovered: number
}

const VIDEO_SETTINGS = {
  freeActiveVideoLimit: 'feed_video_quota_free_limit',
  premiumActiveVideoLimit: 'feed_video_quota_premium_limit',
  premiumUnlimitedVideos: 'feed_video_quota_premium_unlimited',
  tiktokCountsTowardQuota: 'feed_tiktok_counts_toward_quota',
  draftsCountTowardStorage: 'feed_drafts_count_toward_storage',
  archivedMediaRetentionDays: 'feed_archived_media_retention_days',
  deletedMediaRetentionDays: 'feed_deleted_media_retention_days',
  staleSuggestionThresholdDays: 'feed_stale_suggestion_threshold_days',
  abandonedDraftCleanupDays: 'feed_abandoned_draft_cleanup_days',
  maxBulkActionSize: 'feed_max_bulk_action_size',
  restoreRequiresAvailableSlot: 'feed_restore_requires_available_slot',
  softDeleteRecoveryWindowDays: 'feed_soft_delete_recovery_window_days',
} as const

const DEFAULT_CONFIG: VideoManagementConfig = {
  freeActiveVideoLimit: DEFAULT_VIDEO_QUOTA.freeActiveVideoLimit,
  premiumActiveVideoLimit: DEFAULT_VIDEO_QUOTA.premiumActiveVideoLimit,
  premiumUnlimitedVideos: DEFAULT_VIDEO_QUOTA.premiumUnlimitedVideos,
  tiktokCountsTowardQuota: DEFAULT_VIDEO_QUOTA.tikTokCountsTowardLimit,
  draftsCountTowardStorage: true,
  archivedMediaRetentionDays: 30,
  deletedMediaRetentionDays: 7,
  staleSuggestionThresholdDays: 45,
  abandonedDraftCleanupDays: 30,
  maxBulkActionSize: 50,
  restoreRequiresAvailableSlot: true,
  softDeleteRecoveryWindowDays: 7,
}

async function readSetting<T>(db: ReturnType<typeof createSupabaseAdmin>, key: string, fallback: T): Promise<T> {
  const { data } = await db.from('settings').select('value').eq('id', key).maybeSingle()
  const value = data ? (data as { value?: unknown }).value : null
  if (typeof fallback === 'boolean') {
    if (value && typeof value === 'object' && 'enabled' in value) return Boolean((value as { enabled: unknown }).enabled) as T
    if (typeof value === 'boolean') return value as T
  }
  if (typeof fallback === 'number') {
    if (value && typeof value === 'object' && 'amount' in value) return Number((value as { amount: unknown }).amount) as T
    if (typeof value === 'number') return value as T
  }
  return fallback
}

export async function loadVideoManagementConfig() {
  const db = createSupabaseAdmin()
  return {
    freeActiveVideoLimit: await readSetting(db, VIDEO_SETTINGS.freeActiveVideoLimit, DEFAULT_CONFIG.freeActiveVideoLimit),
    premiumActiveVideoLimit: await readSetting(db, VIDEO_SETTINGS.premiumActiveVideoLimit, DEFAULT_CONFIG.premiumActiveVideoLimit),
    premiumUnlimitedVideos: await readSetting(db, VIDEO_SETTINGS.premiumUnlimitedVideos, DEFAULT_CONFIG.premiumUnlimitedVideos),
    tiktokCountsTowardQuota: await readSetting(db, VIDEO_SETTINGS.tiktokCountsTowardQuota, DEFAULT_CONFIG.tiktokCountsTowardQuota),
    draftsCountTowardStorage: await readSetting(db, VIDEO_SETTINGS.draftsCountTowardStorage, DEFAULT_CONFIG.draftsCountTowardStorage),
    archivedMediaRetentionDays: await readSetting(db, VIDEO_SETTINGS.archivedMediaRetentionDays, DEFAULT_CONFIG.archivedMediaRetentionDays),
    deletedMediaRetentionDays: await readSetting(db, VIDEO_SETTINGS.deletedMediaRetentionDays, DEFAULT_CONFIG.deletedMediaRetentionDays),
    staleSuggestionThresholdDays: await readSetting(db, VIDEO_SETTINGS.staleSuggestionThresholdDays, DEFAULT_CONFIG.staleSuggestionThresholdDays),
    abandonedDraftCleanupDays: await readSetting(db, VIDEO_SETTINGS.abandonedDraftCleanupDays, DEFAULT_CONFIG.abandonedDraftCleanupDays),
    maxBulkActionSize: await readSetting(db, VIDEO_SETTINGS.maxBulkActionSize, DEFAULT_CONFIG.maxBulkActionSize),
    restoreRequiresAvailableSlot: await readSetting(db, VIDEO_SETTINGS.restoreRequiresAvailableSlot, DEFAULT_CONFIG.restoreRequiresAvailableSlot),
    softDeleteRecoveryWindowDays: await readSetting(db, VIDEO_SETTINGS.softDeleteRecoveryWindowDays, DEFAULT_CONFIG.softDeleteRecoveryWindowDays),
  } satisfies VideoManagementConfig
}

export async function getVideoQuotaUsage(profileId: string): Promise<VideoQuotaUsage> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('feed_vendor_video_quota_usage', { p_profile_id: profileId })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : null
  return {
    activeCount: Number(row?.active_count ?? 0),
    draftCount: Number(row?.draft_count ?? 0),
    archivedCount: Number(row?.archived_count ?? 0),
    processingCount: Number(row?.processing_count ?? 0),
    failedCount: Number(row?.failed_count ?? 0),
    storageBytes: Number(row?.storage_bytes ?? 0),
  }
}

export async function getVideoQuotaForVendor(profileId: string): Promise<VideoQuotaResolution> {
  return resolveVideoQuotaFromEntitlements(profileId)
}

export async function assertVideoQuotaAvailable(profileId: string) {
  const quota = await getVideoQuotaForVendor(profileId)
  if (!quota.canPublish) {
    throw new Error(`Active video limit reached (${quota.activeCount}/${quota.limit})`)
  }
  return quota
}

export async function publishVideoPostAtomic(postId: string, actorProfileId: string) {
  const db = createSupabaseAdmin()
  const { error, data } = await db.rpc('feed_publish_video_post', { p_post_id: postId, p_actor_profile_id: actorProfileId })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : null
  if (!row?.ok) throw new Error(String(row?.message ?? 'Could not publish video post'))
  return row as { ok: boolean; message: string; active_count: number; limit_count: number }
}

export async function restoreVideoPostAtomic(postId: string, actorProfileId: string) {
  const db = createSupabaseAdmin()
  const { error, data } = await db.rpc('feed_restore_video_post', { p_post_id: postId, p_actor_profile_id: actorProfileId })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : null
  if (!row?.ok) throw new Error(String(row?.message ?? 'Could not restore video post'))
  return row as { ok: boolean; message: string; active_count: number; limit_count: number }
}

export async function archiveVideoPostAtomic(postId: string, actorProfileId: string, reason?: string) {
  const db = createSupabaseAdmin()
  const { error, data } = await db.rpc('feed_archive_video_post', { p_post_id: postId, p_actor_profile_id: actorProfileId, p_reason: reason ?? null })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function deleteVideoPostAtomic(postId: string, actorProfileId: string, reason?: string) {
  const db = createSupabaseAdmin()
  const { error, data } = await db.rpc('feed_delete_video_post', { p_post_id: postId, p_actor_profile_id: actorProfileId, p_reason: reason ?? null })
  if (error) throw new Error(error.message)
  return Boolean(data)
}
