export type FeedTabKey = 'for_you' | 'following' | 'nearby' | 'deals' | 'trending'

export type FeedPostKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'TIKTOK' | 'MENU_ITEM' | 'PROMOTION' | 'QUOTE' | 'REPOST' | 'POLL'
export type FeedPostStatus = 'draft' | 'processing' | 'published' | 'limited' | 'under_review' | 'rejected' | 'archived' | 'deleted'
export type FeedVisibility = 'public' | 'followers' | 'private' | 'unlisted'

export interface FeedWeights {
  proximityWeight: number
  campusWeight: number
  freshnessWeight: number
  watchCompletionWeight: number
  watchTimeWeight: number
  engagementWeight: number
  menuClickWeight: number
  addToCartWeight: number
  orderConversionWeight: number
  revenueConversionWeight: number
  vendorReliabilityWeight: number
  riderReliabilityWeight: number
  premiumBoostWeight: number
  featuredPlacementWeight: number
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
  authorAvatarUrl?: string | null
  authorIsSystemAccount?: boolean
  body?: string | null
  contentWarning?: string | null
  locationText?: string | null
  hashtags?: string[]
  media?: FeedMediaSummary[]
  menuItems?: FeedMenuItemSummary[]
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
  watchTimeMs?: number
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
  isFeatured?: boolean
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
  authorVerified?: boolean
  officialCollectionType?: 'new_on_lumex' | 'lumex_picks' | 'morning_collection' | 'evening_collection' | 'breakfast_picks' | 'lunch_picks' | 'dinner_picks' | 'student_budget' | 'open_right_now' | 'closing_soon' | 'rice_lovers' | 'shawarma_picks' | 'pizza_friday' | 'drinks_around_you' | 'fast_delivery_picks' | 'new_vendors' | 'new_menus_week' | 'active_deals' | 'sponsored' | 'event' | null
  officialGenerationReason?: string | null
  officialSelectionMetadata?: Record<string, unknown> | null
  officialSourceType?: string | null
  officialSourceId?: string | null
  officialAreaId?: string | null
  officialAreaScope?: 'city' | 'zone' | null
}

export interface FeedMediaSummary {
  id: string
  kind: 'image' | 'video' | 'embed' | string
  publicUrl: string | null
  providerName?: string | null
  providerUrl?: string | null
  mimeType?: string | null
  altText?: string | null
  caption?: string | null
}

export interface FeedMenuItemSummary {
  id: string
  menuItemId: string | null
  vendorId?: string | null
  name: string
  priceKobo: number | null
  isAvailable: boolean
  isPrimary: boolean
  imageUrl?: string | null
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
  featuredInfluenceEnabled?: boolean
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
  watchTime: number
  engagement: number
  menuClick: number
  addToCart: number
  orderConversion: number
  revenueConversion: number
  vendorReliability: number
  riderReliability: number
  premiumBoost: number
  featuredPlacement: number
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
