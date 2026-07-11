export interface VideoQuotaConfig {
  freeActiveVideoLimit: number
  premiumActiveVideoLimit: number
  premiumUnlimitedVideos: boolean
  tikTokCountsTowardLimit: boolean
  archivedCountsTowardStorage: boolean
  maxVideoSizeBytes: number
  maxVideoDurationSeconds: number
  supportedFormats: string[]
  imageLimits: {
    maxItems: number
    maxBytes: number
  }
  storageQuotaBytes: number
}

export interface VideoQuotaStatus {
  activeVideoCount: number
  limit: number
  unlimited: boolean
  canPublish: boolean
  remaining: number | null
}

export const DEFAULT_VIDEO_QUOTA: VideoQuotaConfig = {
  freeActiveVideoLimit: 60,
  premiumActiveVideoLimit: 240,
  premiumUnlimitedVideos: false,
  tikTokCountsTowardLimit: true,
  archivedCountsTowardStorage: false,
  maxVideoSizeBytes: 100 * 1024 * 1024,
  maxVideoDurationSeconds: 180,
  supportedFormats: ['video/mp4', 'video/webm', 'video/quicktime'],
  imageLimits: { maxItems: 10, maxBytes: 5 * 1024 * 1024 },
  storageQuotaBytes: 2 * 1024 * 1024 * 1024,
}

export function getVideoQuotaLimit(
  isPremium: boolean,
  config: Pick<VideoQuotaConfig, 'freeActiveVideoLimit' | 'premiumActiveVideoLimit' | 'premiumUnlimitedVideos'> = DEFAULT_VIDEO_QUOTA,
): { limit: number; unlimited: boolean } {
  if (isPremium && config.premiumUnlimitedVideos) return { limit: Number.POSITIVE_INFINITY, unlimited: true }
  if (isPremium) return { limit: config.premiumActiveVideoLimit, unlimited: false }
  return { limit: config.freeActiveVideoLimit, unlimited: false }
}

export function assessVideoQuota(
  activeVideoCount: number,
  isPremium: boolean,
  config: Pick<VideoQuotaConfig, 'freeActiveVideoLimit' | 'premiumActiveVideoLimit' | 'premiumUnlimitedVideos'> = DEFAULT_VIDEO_QUOTA,
): VideoQuotaStatus {
  const { limit, unlimited } = getVideoQuotaLimit(isPremium, config)
  const canPublish = unlimited || activeVideoCount < limit
  return {
    activeVideoCount,
    limit,
    unlimited,
    canPublish,
    remaining: unlimited ? null : Math.max(limit - activeVideoCount, 0),
  }
}

