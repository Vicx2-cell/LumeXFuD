import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getAllFeatures } from '@/lib/features'
import { getCurrentUser } from '@/lib/session'
import type { FeedCandidate, FeedTabKey, FeedViewerContext } from './types'
import { rankFeedCandidates } from './ranking'
import { feedTabKeySchema } from './validators'
import crypto from 'node:crypto'

export interface FeedSnapshot {
  tab: FeedTabKey
  tabs: Record<FeedTabKey, boolean>
  version: string
  items: ReturnType<typeof rankFeedCandidates>['items']
  nextCursor: string | null
  hasMore: boolean
}

type FeedDecorations = {
  likedPosts: Set<string>
  bookmarkedPosts: Set<string>
  repostedPosts: Set<string>
  followedAuthors: Set<string>
  mutedAuthors: Set<string>
  blockedAuthors: Set<string>
  authorMeta: Map<string, { handle: string | null; display_name: string | null }>
  activePromotions: Set<string>
}

type LoadedIdRow = Record<string, unknown>

export async function loadFeedViewerContext() : Promise<FeedViewerContext> {
  const session = await getCurrentUser()
  if (!session) return {}

  const db = createSupabaseAdmin()
  let query = db.from('social_profiles').select('id, profile_kind, campus_id, zone_id')
  if (session.role === 'customer') query = query.eq('customer_id', session.userId ?? '')
  if (session.role === 'vendor') query = query.eq('vendor_id', session.userId ?? '')
  if (session.role === 'rider') query = query.eq('rider_id', session.userId ?? '')
  if (session.role === 'admin' || session.role === 'super_admin') query = query.eq('admin_id', session.userId ?? '')
  const { data: profile } = await query.maybeSingle()

  return {
    profileId: profile?.id ?? null,
    role: session.role,
    campusId: profile?.campus_id ?? null,
    zoneId: profile?.zone_id ?? null,
  }
}

export async function ensureSocialProfileForSession() {
  const session = await getCurrentUser()
  if (!session || !session.userId) return null

  const db = createSupabaseAdmin()
  const roleToColumn = session.role === 'customer'
    ? 'customer_id'
    : session.role === 'vendor'
      ? 'vendor_id'
      : session.role === 'rider'
        ? 'rider_id'
        : 'admin_id'

  const { data: existing } = await db
    .from('social_profiles')
    .select('id, profile_kind, handle, display_name, campus_id, zone_id')
    .eq(roleToColumn, session.userId)
    .maybeSingle()
  if (existing) return existing as {
    id: string
    profile_kind: string
    handle: string
    display_name: string
    campus_id: string | null
    zone_id: string | null
  }

  let displayName = session.name ?? session.phone
  if (!displayName) displayName = `${session.role} ${session.userId.slice(0, 6)}`

  if (session.role === 'customer') {
    const { data } = await db.from('customers').select('name').eq('id', session.userId).maybeSingle()
    displayName = (data?.name as string | null)?.trim() || displayName
  } else if (session.role === 'vendor') {
    const { data } = await db.from('vendors').select('shop_name').eq('id', session.userId).maybeSingle()
    displayName = (data?.shop_name as string | null)?.trim() || displayName
  } else if (session.role === 'rider') {
    const { data } = await db.from('riders').select('full_name').eq('id', session.userId).maybeSingle()
    displayName = (data?.full_name as string | null)?.trim() || displayName
  } else if (session.role === 'admin' || session.role === 'super_admin') {
    const { data } = await db.from('admins').select('name').eq('id', session.userId).maybeSingle()
    displayName = (data?.name as string | null)?.trim() || displayName
  }

  const handle = `${session.role}-${session.userId.slice(0, 8)}-${crypto.randomBytes(2).toString('hex')}`
  const { data: inserted } = await db
    .from('social_profiles')
    .insert({
      [roleToColumn]: session.userId,
      profile_kind: session.role === 'super_admin' ? 'admin' : session.role,
      handle,
      display_name: displayName.slice(0, 120),
    })
    .select('id, profile_kind, handle, display_name, campus_id, zone_id')
    .single()

  return inserted as {
    id: string
    profile_kind: string
    handle: string
    display_name: string
    campus_id: string | null
    zone_id: string | null
  } | null
}

async function loadFeedCandidates(tab: FeedTabKey): Promise<FeedCandidate[]> {
  const db = createSupabaseAdmin()
  let query = db
    .from('posts')
    .select(`
      id, author_profile_id, vendor_id, zone_id, campus_id, post_kind, status, visibility,
      published_at, created_at, view_count, like_count, reply_count, repost_count,
      bookmark_count, share_count, menu_click_count, cart_add_count, order_count,
      revenue_kobo
    `)
    .eq('status', 'published')
    .is('deleted_at', null)
    .limit(200)

  if (tab === 'trending') query = query.order('order_count', { ascending: false })
  else if (tab === 'deals') query = query.order('revenue_kobo', { ascending: false })
  else query = query.order('published_at', { ascending: false })

  const { data } = await query

  const rows = (data ?? []) as Array<{
    id: string
    author_profile_id: string
    vendor_id: string | null
    zone_id: string | null
    campus_id: string | null
    post_kind: FeedCandidate['postKind']
    status: FeedCandidate['status']
    visibility: FeedCandidate['visibility']
    published_at: string | null
    created_at: string
    view_count?: number | null
    like_count?: number | null
    reply_count?: number | null
    repost_count?: number | null
    bookmark_count?: number | null
    share_count?: number | null
    menu_click_count?: number | null
    cart_add_count?: number | null
    order_count?: number | null
    revenue_kobo?: number | null
  }>

  return rows.map((row) => ({
    id: row.id,
    authorProfileId: row.author_profile_id,
    vendorId: row.vendor_id,
    zoneId: row.zone_id,
    campusId: row.campus_id,
    postKind: row.post_kind,
    status: row.status,
    visibility: row.visibility,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    viewCount: row.view_count ?? 0,
    likeCount: row.like_count ?? 0,
    replyCount: row.reply_count ?? 0,
    repostCount: row.repost_count ?? 0,
    saveCount: row.bookmark_count ?? 0,
    shareCount: row.share_count ?? 0,
    menuClickCount: row.menu_click_count ?? 0,
    addToCartCount: row.cart_add_count ?? 0,
    orderCount: row.order_count ?? 0,
    revenueKobo: row.revenue_kobo ?? 0,
    freshnessHours: row.published_at ? Math.max(0, (Date.now() - new Date(row.published_at).getTime()) / 3_600_000) : 24,
    watchCompletionRate: 0,
    rewatchRate: 0,
    vendorReliability: 0.5,
    riderReliability: 0.5,
    negativeFeedbackCount: 0,
    reportCount: 0,
    blockCount: 0,
    isPremiumBoosted: false,
    isSponsored: false,
    repetitionScore: 0,
    qualityScore: 0.5,
    explorationScore: 0.2,
  }))
}

async function loadFeedDecorations(profileId: string, postIds: string[], authorIds: string[]): Promise<FeedDecorations> {
  const db = createSupabaseAdmin()
  const loadIds = async (table: string, ownerColumn: string, relationColumn: string, ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set<string>()
    const { data } = await db.from(table).select(relationColumn).eq(ownerColumn, profileId).in(relationColumn, ids)
    return new Set((data ?? []).map((row) => String((row as unknown as LoadedIdRow)[relationColumn])))
  }

  const [
    likedPosts,
    bookmarkedPosts,
    repostedPosts,
    followedAuthors,
    mutedAuthors,
    blockedOutgoing,
    blockedIncoming,
    authorRows,
    activePromotionRows,
  ] = await Promise.all([
    loadIds('post_likes', 'profile_id', 'post_id', postIds),
    loadIds('bookmarks', 'profile_id', 'post_id', postIds),
    loadIds('reposts', 'profile_id', 'post_id', postIds),
    loadIds('follows', 'follower_profile_id', 'followed_profile_id', authorIds),
    loadIds('mutes', 'muter_profile_id', 'muted_profile_id', authorIds),
    loadIds('blocks', 'blocker_profile_id', 'blocked_profile_id', authorIds),
    authorIds.length === 0
      ? Promise.resolve({ data: [] })
      : db.from('blocks').select('blocker_profile_id').eq('blocked_profile_id', profileId).in('blocker_profile_id', authorIds),
    authorIds.length === 0
      ? Promise.resolve({ data: [] })
      : db.from('social_profiles').select('id, handle, display_name').in('id', authorIds),
    postIds.length === 0
      ? Promise.resolve({ data: [] })
      : db
          .from('post_promotions')
          .select('post_id')
          .in('post_id', postIds)
          .in('status', ['active', 'scheduled']),
  ])

  const blockedAuthors = new Set<string>([
    ...Array.from(blockedOutgoing),
    ...((blockedIncoming.data ?? []).map((row) => String((row as { blocker_profile_id: string }).blocker_profile_id))),
  ])

  const authorMeta = new Map<string, { handle: string | null; display_name: string | null }>()
  for (const row of authorRows.data ?? []) {
    const a = row as { id: string; handle: string | null; display_name: string | null }
    authorMeta.set(a.id, { handle: a.handle, display_name: a.display_name })
  }

  const activePromotions = new Set<string>((activePromotionRows.data ?? []).map((row) => String((row as { post_id: string }).post_id)))

  return { likedPosts, bookmarkedPosts, repostedPosts, followedAuthors, mutedAuthors, blockedAuthors, authorMeta, activePromotions }
}

function makeCursor(item: { id: string; score: number; publishedAt: string | null; createdAt: string }) {
  return Buffer.from(JSON.stringify({
    id: item.id,
    score: item.score,
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
  })).toString('base64url')
}

function decodeCursor(cursor?: string) {
  if (!cursor) return null
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      id?: string
      score?: number
      publishedAt?: string | null
      createdAt?: string
    }
    return decoded.id ? decoded : null
  } catch {
    return null
  }
}

export async function loadFeedSnapshot(tabInput?: string, cursorInput?: string, limit = 20): Promise<FeedSnapshot> {
  const parsedTab = feedTabKeySchema.safeParse(tabInput)
  const tab = parsedTab.success ? parsedTab.data : 'for_you'
  const tabs = await getAllFeatures()
  const viewer = await loadFeedViewerContext()
  const candidates = await loadFeedCandidates(tab)
  let rankingSource = candidates
  if (viewer.profileId) {
    const decorations = await loadFeedDecorations(
      viewer.profileId,
      candidates.map((c) => c.id),
      candidates.map((c) => c.authorProfileId),
    )
    rankingSource = candidates.filter((candidate) => {
      if (decorations.blockedAuthors.has(candidate.authorProfileId)) return false
      if (decorations.mutedAuthors.has(candidate.authorProfileId)) return false
      if (tab === 'following' && !decorations.followedAuthors.has(candidate.authorProfileId)) return false
      if (tab === 'nearby') {
        const sameCampus = Boolean(viewer.campusId && candidate.campusId && viewer.campusId === candidate.campusId)
        const sameZone = Boolean(viewer.zoneId && candidate.zoneId && viewer.zoneId === candidate.zoneId)
        if (!sameCampus && !sameZone) return false
      }
      if (tab === 'deals' && !decorations.activePromotions.has(candidate.id) && candidate.postKind !== 'PROMOTION') return false
      if (tab === 'trending' && candidate.likeCount === 0 && candidate.replyCount === 0 && candidate.repostCount === 0 && candidate.orderCount === 0) return false
      return true
    })
    for (const candidate of rankingSource) {
      const meta = decorations.authorMeta.get(candidate.authorProfileId)
      candidate.authorHandle = meta?.handle ?? null
      candidate.authorDisplayName = meta?.display_name ?? null
      candidate.viewerHasLiked = decorations.likedPosts.has(candidate.id)
      candidate.viewerHasBookmarked = decorations.bookmarkedPosts.has(candidate.id)
      candidate.viewerHasReposted = decorations.repostedPosts.has(candidate.id)
      candidate.viewerFollowsAuthor = decorations.followedAuthors.has(candidate.authorProfileId)
      candidate.viewerMutedAuthor = decorations.mutedAuthors.has(candidate.authorProfileId)
      candidate.viewerBlockedAuthor = decorations.blockedAuthors.has(candidate.authorProfileId)
      candidate.isSponsored = decorations.activePromotions.has(candidate.id) || candidate.isSponsored
    }
  } else if (tab === 'following' || tab === 'nearby') {
    rankingSource = []
  }

  const ranking = rankFeedCandidates(rankingSource, {
    ...viewer,
    blockedAuthor: false,
    mutedAuthor: false,
  })

  const cursor = decodeCursor(cursorInput)
  let startIndex = 0
  if (cursor?.id) {
    const idx = ranking.items.findIndex((item) => item.id === cursor.id)
    if (idx >= 0) startIndex = idx + 1
  }
  const pageItems = ranking.items.slice(startIndex, startIndex + limit)
  const hasMore = ranking.items.length > startIndex + pageItems.length
  const nextCursor = hasMore && pageItems.length > 0 ? makeCursor(pageItems[pageItems.length - 1]!) : null

  return {
    tab,
    tabs: {
      for_you: tabs.feed_for_you_enabled ?? true,
      following: tabs.feed_following_enabled ?? true,
      nearby: tabs.feed_nearby_enabled ?? true,
      deals: tabs.feed_deals_enabled ?? true,
      trending: tabs.feed_trending_enabled ?? true,
    },
    version: ranking.version,
    items: pageItems,
    nextCursor,
    hasMore,
  }
}
