export type FeedTabKey = 'for_you' | 'following' | 'nearby' | 'deals' | 'trending'

export type FeedPostKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'TIKTOK' | 'MENU_ITEM' | 'PROMOTION' | 'QUOTE' | 'REPOST' | 'POLL'
export type FeedPostStatus = 'draft' | 'processing' | 'published' | 'limited' | 'under_review' | 'rejected' | 'archived' | 'deleted'
export type FeedVisibility = 'public' | 'followers' | 'private' | 'unlisted'

export interface FeedWeights {
  proximityWeight: number
  campusWeight: number
  freshnessWeight: number
  watchCompletionWeight: number
  engagementWeight: number
  menuClickWeight: number
  addToCartWeight: number
  orderConversionWeight: number
  revenueConversionWeight: number
  vendorReliabilityWeight: number
  riderReliabilityWeight: number
  premiumBoostWeight: number
  sponsoredBoostWeight: number
  negativeFeedbackPenalty: number
  cancellationPenalty: number
  repetitionPenalty: number
  reportPenalty: number
  blockPenalty: number
  qualityWeight: number
  explorationBoost: number
}

export interface FeedCandidate {
  id: string
  authorProfileId: string
  authorHandle?: string | null
  authorDisplayName?: string | null
  vendorId?: string | null
  zoneId?: string | null
  campusId?: string | null
  postKind: FeedPostKind
  status: FeedPostStatus
  visibility: FeedVisibility
  publishedAt: string | null
  createdAt: string
  viewCount?: number
  likeCount?: number
  replyCount?: number
  repostCount?: number
  saveCount?: number
  shareCount?: number
  menuClickCount?: number
  addToCartCount?: number
  orderCount?: number
  revenueKobo?: number
  watchCompletionRate?: number
  rewatchRate?: number
  dwellTimeMs?: number
  freshnessHours?: number
  vendorReliability?: number
  riderReliability?: number
  negativeFeedbackCount?: number
  reportCount?: number
  blockCount?: number
  isPremiumBoosted?: boolean
  isSponsored?: boolean
  repetitionScore?: number
  qualityScore?: number
  explorationScore?: number
  viewerHasLiked?: boolean
  viewerHasBookmarked?: boolean
  viewerHasReposted?: boolean
  viewerFollowsAuthor?: boolean
  viewerMutedAuthor?: boolean
  viewerBlockedAuthor?: boolean
}

export interface FeedViewerContext {
  profileId?: string | null
  role?: 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'
  campusId?: string | null
  zoneId?: string | null
  followsAuthor?: boolean
  blockedAuthor?: boolean
  mutedAuthor?: boolean
  hasPremium?: boolean
  premiumInfluenceEnabled?: boolean
  sponsorInfluenceEnabled?: boolean
}

export interface RankedFeedCandidate extends FeedCandidate {
  score: number
  explanation: FeedScoreBreakdown
}

export interface FeedScoreBreakdown {
  proximity: number
  campus: number
  freshness: number
  watchCompletion: number
  engagement: number
  menuClick: number
  addToCart: number
  orderConversion: number
  revenueConversion: number
  vendorReliability: number
  riderReliability: number
  premiumBoost: number
  sponsoredBoost: number
  negativeFeedbackPenalty: number
  cancellationPenalty: number
  repetitionPenalty: number
  reportPenalty: number
  blockPenalty: number
  quality: number
  exploration: number
}

export interface FeedRankingResult {
  version: string
  items: RankedFeedCandidate[]
}
