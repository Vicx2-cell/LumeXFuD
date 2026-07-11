import type {
  FeedCandidate,
  FeedRankingResult,
  FeedScoreBreakdown,
  FeedViewerContext,
  FeedWeights,
  RankedFeedCandidate,
} from './types'

export const FEED_ALGORITHM_VERSION = '2026-07-10.feed.v1'

export const DEFAULT_FEED_WEIGHTS: FeedWeights = {
  proximityWeight: 1.3,
  campusWeight: 1.1,
  freshnessWeight: 1.0,
  watchCompletionWeight: 1.2,
  engagementWeight: 1.0,
  menuClickWeight: 1.1,
  addToCartWeight: 1.2,
  orderConversionWeight: 1.35,
  revenueConversionWeight: 1.15,
  vendorReliabilityWeight: 0.9,
  riderReliabilityWeight: 0.4,
  premiumBoostWeight: 0.35,
  sponsoredBoostWeight: 0.25,
  negativeFeedbackPenalty: 1.1,
  cancellationPenalty: 1.25,
  repetitionPenalty: 0.8,
  reportPenalty: 1.4,
  blockPenalty: 3.0,
  qualityWeight: 0.8,
  explorationBoost: 0.45,
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const safeNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function scoreFreshness(hours: number): number {
  if (hours <= 1) return 1
  if (hours >= 72) return 0
  return clamp(1 - hours / 72, 0, 1)
}

function scoreProximity(candidate: FeedCandidate, viewer: FeedViewerContext): number {
  if (viewer.blockedAuthor || viewer.mutedAuthor) return 0
  if (!viewer.zoneId || !candidate.zoneId) return 0.2
  return viewer.zoneId === candidate.zoneId ? 1 : 0.25
}

function scoreCampus(candidate: FeedCandidate, viewer: FeedViewerContext): number {
  if (!viewer.campusId || !candidate.campusId) return 0.2
  return viewer.campusId === candidate.campusId ? 1 : 0.3
}

function scoreEngagement(candidate: FeedCandidate): number {
  const like = safeNumber(candidate.likeCount)
  const reply = safeNumber(candidate.replyCount)
  const repost = safeNumber(candidate.repostCount)
  const save = safeNumber(candidate.saveCount)
  const share = safeNumber(candidate.shareCount)
  const impression = Math.max(1, safeNumber(candidate.viewCount))
  return clamp((like * 1 + reply * 1.5 + repost * 1.3 + save * 1.1 + share * 1.2) / impression, 0, 2)
}

function buildBreakdown(candidate: FeedCandidate, viewer: FeedViewerContext): FeedScoreBreakdown {
  const freshness = scoreFreshness(safeNumber(candidate.freshnessHours, 24))
  const watchCompletion = clamp(safeNumber(candidate.watchCompletionRate), 0, 1)
  const engagement = scoreEngagement(candidate)
  const menuClick = clamp(safeNumber(candidate.menuClickCount) / 20, 0, 2)
  const addToCart = clamp(safeNumber(candidate.addToCartCount) / 12, 0, 2)
  const orderConversion = clamp(safeNumber(candidate.orderCount) / 6, 0, 2.5)
  const revenueConversion = clamp(safeNumber(candidate.revenueKobo) / 100_000, 0, 2.5)
  const vendorReliability = clamp(safeNumber(candidate.vendorReliability, 0.5), 0, 1.5)
  const riderReliability = clamp(safeNumber(candidate.riderReliability, 0.5), 0, 1.5)
  const premiumBoost = viewer.premiumInfluenceEnabled && candidate.isPremiumBoosted && viewer.hasPremium
    ? 1
    : candidate.isPremiumBoosted
      ? 0.5
      : 0
  const sponsoredBoost = viewer.sponsorInfluenceEnabled && candidate.isSponsored ? 1 : candidate.isSponsored ? 0.5 : 0
  const negativeFeedbackPenalty = clamp(safeNumber(candidate.negativeFeedbackCount) / 8, 0, 3)
  const cancellationPenalty = clamp(safeNumber(candidate.repetitionScore) * 0.2, 0, 2)
  const repetitionPenalty = clamp(safeNumber(candidate.repetitionScore), 0, 3)
  const reportPenalty = clamp(safeNumber(candidate.reportCount) / 4, 0, 4)
  const blockPenalty = viewer.blockedAuthor ? 1 : clamp(safeNumber(candidate.blockCount), 0, 4)
  const quality = clamp(safeNumber(candidate.qualityScore, 0.5), 0, 1.5)
  const exploration = clamp(safeNumber(candidate.explorationScore, 0.2), 0, 1)

  return {
    proximity: scoreProximity(candidate, viewer),
    campus: scoreCampus(candidate, viewer),
    freshness,
    watchCompletion,
    engagement,
    menuClick,
    addToCart,
    orderConversion,
    revenueConversion,
    vendorReliability,
    riderReliability,
    premiumBoost,
    sponsoredBoost,
    negativeFeedbackPenalty,
    cancellationPenalty,
    repetitionPenalty,
    reportPenalty,
    blockPenalty,
    quality,
    exploration,
  }
}

export function scoreFeedCandidate(
  candidate: FeedCandidate,
  viewer: FeedViewerContext,
  weights: FeedWeights = DEFAULT_FEED_WEIGHTS,
): RankedFeedCandidate {
  const explanation = buildBreakdown(candidate, viewer)
  const organic =
    explanation.proximity * weights.proximityWeight +
    explanation.campus * weights.campusWeight +
    explanation.freshness * weights.freshnessWeight +
    explanation.watchCompletion * weights.watchCompletionWeight +
    explanation.engagement * weights.engagementWeight +
    explanation.menuClick * weights.menuClickWeight +
    explanation.addToCart * weights.addToCartWeight +
    explanation.orderConversion * weights.orderConversionWeight +
    explanation.revenueConversion * weights.revenueConversionWeight +
    explanation.vendorReliability * weights.vendorReliabilityWeight +
    explanation.riderReliability * weights.riderReliabilityWeight +
    explanation.quality * weights.qualityWeight +
    explanation.exploration * weights.explorationBoost

  const paid =
    explanation.premiumBoost * weights.premiumBoostWeight +
    explanation.sponsoredBoost * weights.sponsoredBoostWeight

  const penalties =
    explanation.negativeFeedbackPenalty * weights.negativeFeedbackPenalty +
    explanation.cancellationPenalty * weights.cancellationPenalty +
    explanation.repetitionPenalty * weights.repetitionPenalty +
    explanation.reportPenalty * weights.reportPenalty +
    explanation.blockPenalty * weights.blockPenalty

  const blockedFloor = viewer.blockedAuthor ? -999 : 0
  const score = Math.round((organic + paid - penalties + blockedFloor) * 1000) / 1000
  return { ...candidate, score, explanation }
}

export function rankFeedCandidates(
  candidates: FeedCandidate[],
  viewer: FeedViewerContext,
  weights: FeedWeights = DEFAULT_FEED_WEIGHTS,
): FeedRankingResult {
  const items = candidates
    .map((candidate) => scoreFeedCandidate(candidate, viewer, weights))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const aTime = new Date(a.publishedAt ?? a.createdAt).getTime()
      const bTime = new Date(b.publishedAt ?? b.createdAt).getTime()
      return bTime - aTime
    })

  return { version: FEED_ALGORITHM_VERSION, items }
}

export function simulateFeedRanking(
  candidates: FeedCandidate[],
  viewer: FeedViewerContext,
  weights: Partial<FeedWeights> = {},
): FeedRankingResult {
  return rankFeedCandidates(candidates, viewer, { ...DEFAULT_FEED_WEIGHTS, ...weights })
}
