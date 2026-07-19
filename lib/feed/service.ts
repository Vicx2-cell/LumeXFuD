import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getAllFeatures } from '@/lib/features'
import { getPremiumStatus } from '@/lib/premium'
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
  authorMeta: Map<string, {
    handle: string | null
    display_name: string | null
    avatar_url: string | null
    premium_verified: boolean
    premium_featured_until: string | null
    premium_label: string | null
    is_system_account: boolean
  }>
  activePromotions: Set<string>
}

type LoadedIdRow = Record<string, unknown>

export function shouldHidePromotionFromForYou(tab: FeedTabKey, postKind: FeedCandidate['postKind']) {
  return tab === 'for_you' && postKind === 'PROMOTION'
}

export async function loadFeedViewerContext() : Promise<FeedViewerContext> {
  const session = await getCurrentUser()
  if (!session) return {}

  const db = createSupabaseAdmin()
  const baseQuery = db.from('social_profiles').select('id, profile_kind, campus_id, zone_id')
  const { data: profile } = session.role === 'super_admin'
    ? await db
        .from('social_profiles')
        .select('id, profile_kind, campus_id, zone_id')
        .or(`customer_id.eq.${session.userId},admin_id.eq.${session.userId}`)
        .maybeSingle()
    : await (session.role === 'customer'
      ? baseQuery.eq('customer_id', session.userId ?? '').maybeSingle()
      : session.role === 'vendor'
        ? baseQuery.eq('vendor_id', session.userId ?? '').maybeSingle()
        : session.role === 'rider'
          ? baseQuery.eq('rider_id', session.userId ?? '').maybeSingle()
          : baseQuery.eq('admin_id', session.userId ?? '').maybeSingle())

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
  const lookup = session.role === 'super_admin'
    ? await Promise.all(
        ['customer_id', 'admin_id'].map(async (column) => {
          const { data } = await db
            .from('social_profiles')
            .select('id, profile_kind, handle, display_name, campus_id, zone_id')
            .eq(column, session.userId)
            .maybeSingle()
          return data ?? null
        }),
      )
    : [await db
        .from('social_profiles')
        .select('id, profile_kind, handle, display_name, campus_id, zone_id')
        .eq(roleToColumn, session.userId)
        .maybeSingle()
        .then(({ data }) => data ?? null)]

  const existing = lookup.find(Boolean)
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
    const [adminResult, customerResult] = await Promise.all([
      db.from('admins').select('name').eq('id', session.userId).maybeSingle(),
      session.role === 'super_admin'
        ? db.from('customers').select('name').eq('id', session.userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const admin = adminResult.data
    const customer = customerResult.data
    displayName = (admin?.name as string | null)?.trim() || (customer?.name as string | null)?.trim() || displayName
  }

  const handle = `${session.role}-${session.userId.slice(0, 8)}-${crypto.randomBytes(2).toString('hex')}`
  const superAdminColumn = session.role === 'super_admin'
    ? (await db.from('admins').select('id').eq('id', session.userId).maybeSingle()).data ? 'admin_id' : 'customer_id'
    : roleToColumn
  const { data: inserted } = await db
    .from('social_profiles')
    .insert({
      [superAdminColumn]: session.userId,
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
      id, author_profile_id, vendor_id, related_menu_item_id, zone_id, campus_id, post_kind, status, visibility,
      body, content_warning, location_text, hashtags_cached,
      published_at, created_at, view_count, like_count, reply_count, repost_count,
      bookmark_count, share_count, menu_click_count, cart_add_count, order_count,
      revenue_kobo, watch_time_ms, completion_rate, location_relevance_score, order_conversion_count,
      safe_rank_score
    `)
    .eq('status', 'published')
    .is('deleted_at', null)
    .limit(60)

  if (tab === 'trending') query = query.order('order_count', { ascending: false })
  else if (tab === 'deals') query = query.order('revenue_kobo', { ascending: false })
  else query = query.order('published_at', { ascending: false })

  const { data, error } = await query
  if (error) {
    console.error('[feed/service] base post query failed:', error.message)
    return []
  }

  const rows = (data ?? []) as Array<{
    id: string
    author_profile_id: string
    vendor_id: string | null
    related_menu_item_id: string | null
    zone_id: string | null
    campus_id: string | null
    post_kind: FeedCandidate['postKind']
    status: FeedCandidate['status']
    visibility: FeedCandidate['visibility']
    body?: string | null
    content_warning?: string | null
    location_text?: string | null
    hashtags_cached?: string[] | null
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
    watch_time_ms?: number | null
    completion_rate?: number | null
    location_relevance_score?: number | null
    order_conversion_count?: number | null
    safe_rank_score?: number | null
  }>

  const postIds = rows.map((row) => row.id)
  const relatedMenuIds = rows
    .map((row) => row.related_menu_item_id)
    .filter((id): id is string => Boolean(id))
  const [mediaResult, menuResult, officialResult] = postIds.length > 0
    ? await Promise.all([
      db
        .from('post_media')
        .select('id, post_id, media_kind, public_url, provider_name, provider_url, mime_type, alt_text, caption, sort_order, is_primary')
        .in('post_id', postIds),
      db
        .from('post_menu_items')
        .select('id, post_id, menu_item_id, menu_item_name_snapshot, menu_item_price_kobo_snapshot, is_available_snapshot, is_primary, menu_item_image_url_snapshot')
        .in('post_id', postIds),
      db
        .from('official_feed_posts')
        .select('id, post_id, area_scope, area_id, collection_type, source_type, source_id, generation_reason, selection_metadata, is_auto_published, approved_at, approved_by, archived_at, archived_reason')
        .in('post_id', postIds),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const mediaByPostId = new Map<string, Array<{
    id: string
    post_id: string
    media_kind: string
    public_url: string | null
    provider_name: string | null
    provider_url: string | null
    mime_type: string | null
    alt_text: string | null
    caption: string | null
    sort_order: number | null
    is_primary: boolean | null
  }>>()
  for (const row of (mediaResult.data ?? []) as Array<{
    id: string
    post_id: string
    media_kind: string
    public_url: string | null
    provider_name: string | null
    provider_url: string | null
    mime_type: string | null
    alt_text: string | null
    caption: string | null
    sort_order: number | null
    is_primary: boolean | null
  }>) {
    const list = mediaByPostId.get(row.post_id) ?? []
    list.push(row)
    mediaByPostId.set(row.post_id, list)
  }

  const menuByPostId = new Map<string, Array<{
    id: string
    post_id: string
    menu_item_id: string | null
    menu_item_name_snapshot: string | null
    menu_item_price_kobo_snapshot: number | null
    is_available_snapshot: boolean | null
    is_primary: boolean | null
    menu_item_image_url_snapshot: string | null
  }>>()
  for (const row of (menuResult.data ?? []) as Array<{
    id: string
    post_id: string
    menu_item_id: string | null
    menu_item_name_snapshot: string | null
    menu_item_price_kobo_snapshot: number | null
    is_available_snapshot: boolean | null
    is_primary: boolean | null
    menu_item_image_url_snapshot: string | null
    [key: string]: unknown
  }>) {
    if (!postIds.includes(row.post_id)) continue
    const list = menuByPostId.get(row.post_id) ?? []
    list.push(row)
    menuByPostId.set(row.post_id, list)
  }

  const officialByPostId = new Map<string, Array<{
    id: string
    post_id: string
    area_scope: 'city' | 'zone'
    area_id: string
    collection_type: 'new_on_lumex' | 'lumex_picks' | 'morning_collection' | 'evening_collection' | 'breakfast_picks' | 'lunch_picks' | 'dinner_picks' | 'student_budget' | 'open_right_now' | 'closing_soon' | 'rice_lovers' | 'shawarma_picks' | 'pizza_friday' | 'drinks_around_you' | 'fast_delivery_picks' | 'new_vendors' | 'new_menus_week' | 'active_deals' | 'sponsored' | 'event'
    source_type: string
    source_id: string
    generation_reason: string
    selection_metadata: Record<string, unknown> | null
    is_auto_published: boolean
    approved_at: string | null
    approved_by: string | null
    archived_at: string | null
    archived_reason: string | null
  }>>()
  for (const row of (officialResult.data ?? []) as Array<{
    id: string
    post_id: string
    area_scope: 'city' | 'zone'
    area_id: string
    collection_type: 'new_on_lumex' | 'lumex_picks' | 'morning_collection' | 'evening_collection' | 'breakfast_picks' | 'lunch_picks' | 'dinner_picks' | 'student_budget' | 'open_right_now' | 'closing_soon' | 'rice_lovers' | 'shawarma_picks' | 'pizza_friday' | 'drinks_around_you' | 'fast_delivery_picks' | 'new_vendors' | 'new_menus_week' | 'active_deals' | 'sponsored' | 'event'
    source_type: string
    source_id: string
    generation_reason: string
    selection_metadata: Record<string, unknown> | null
    is_auto_published: boolean
    approved_at: string | null
    approved_by: string | null
    archived_at: string | null
    archived_reason: string | null
  }>) {
    if (!postIds.includes(row.post_id)) continue
    const list = officialByPostId.get(row.post_id) ?? []
    list.push(row)
    officialByPostId.set(row.post_id, list)
  }

  const liveMenuIds = Array.from(
    new Set([
      ...relatedMenuIds,
      ...(menuResult.data ?? [])
        .map((row) => (row as { menu_item_id: string | null }).menu_item_id)
        .filter((id): id is string => Boolean(id)),
    ]),
  )
  const { data: liveMenuRows } = liveMenuIds.length > 0
    ? await db
      .from('menu_items')
      .select('id, vendor_id, name, price_kobo, image_url, is_available, deleted_at')
      .in('id', liveMenuIds)
      .is('deleted_at', null)
    : { data: [] as Array<{
      id: string
      vendor_id: string
      name: string
      price_kobo: number
      image_url: string | null
      is_available: boolean
      deleted_at: string | null
    }> }
  const liveMenuById = new Map((liveMenuRows ?? []).map((row) => [String(row.id), row]))

  const buildMenuItems = (row: {
    id: string
    vendor_id: string | null
    related_menu_item_id: string | null
  }) => {
    const explicitItems = (menuByPostId.get(row.id) ?? []).map((item) => {
      const live = item.menu_item_id ? liveMenuById.get(item.menu_item_id) : null
      const belongsToVendor = Boolean(live && row.vendor_id && String(live.vendor_id) === String(row.vendor_id))
      return {
        id: item.id,
        menuItemId: item.menu_item_id,
        vendorId: belongsToVendor ? String(live?.vendor_id ?? row.vendor_id ?? null) : null,
        name: belongsToVendor ? String(live?.name ?? item.menu_item_name_snapshot ?? 'Menu item') : String(item.menu_item_name_snapshot ?? 'Menu item'),
        priceKobo: belongsToVendor && typeof live?.price_kobo === 'number' ? Number(live.price_kobo) : null,
        isAvailable: belongsToVendor ? Boolean(live?.is_available) : Boolean(item.is_available_snapshot ?? false),
        isPrimary: item.is_primary ?? false,
        imageUrl: belongsToVendor ? live?.image_url ?? item.menu_item_image_url_snapshot ?? null : item.menu_item_image_url_snapshot ?? null,
      }
    })
    if (explicitItems.length > 0) return explicitItems

    const related = row.related_menu_item_id ? liveMenuById.get(row.related_menu_item_id) : null
    if (!related) return []

    return [{
      id: `${row.id}:related-menu-item`,
      menuItemId: row.related_menu_item_id,
      vendorId: String(related.vendor_id ?? row.vendor_id ?? null),
      name: String(related.name ?? 'Menu item'),
      priceKobo: typeof related.price_kobo === 'number' ? Number(related.price_kobo) : null,
      isAvailable: Boolean(related.is_available),
      isPrimary: true,
      imageUrl: related.image_url ?? null,
    }]
  }

  return rows.map((row) => ({
    id: row.id,
    vendorId: row.vendor_id,
    authorProfileId: row.author_profile_id,
    body: row.body ?? null,
    contentWarning: row.content_warning ?? null,
    locationText: row.location_text ?? null,
    hashtags: row.hashtags_cached ?? [],
    media: (mediaByPostId.get(row.id) ?? [])
      .slice()
      .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((media) => ({
        id: media.id,
        kind: media.media_kind,
        publicUrl: media.public_url,
        providerName: media.provider_name,
        providerUrl: media.provider_url,
        mimeType: media.mime_type,
        altText: media.alt_text,
        caption: media.caption,
      })),
    menuItems: buildMenuItems(row),
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
    watchTimeMs: row.watch_time_ms ?? 0,
    freshnessHours: row.published_at ? Math.max(0, (Date.now() - new Date(row.published_at).getTime()) / 3_600_000) : 24,
    watchCompletionRate: row.completion_rate ?? 0,
    rewatchRate: 0,
    vendorReliability: 0.5,
    riderReliability: 0.5,
    negativeFeedbackCount: 0,
    reportCount: 0,
    blockCount: 0,
    isPremiumBoosted: false,
    isFeatured: false,
    isSponsored: false,
    repetitionScore: 0,
    qualityScore: row.safe_rank_score ?? 0.5,
    explorationScore: 0.2,
    officialCollectionType: officialByPostId.get(row.id)?.[0]?.collection_type ?? null,
    officialGenerationReason: officialByPostId.get(row.id)?.[0]?.generation_reason ?? null,
    officialSelectionMetadata: officialByPostId.get(row.id)?.[0]?.selection_metadata ?? null,
    officialSourceType: officialByPostId.get(row.id)?.[0]?.source_type ?? null,
    officialSourceId: officialByPostId.get(row.id)?.[0]?.source_id ?? null,
    officialAreaId: officialByPostId.get(row.id)?.[0]?.area_id ?? null,
    officialAreaScope: officialByPostId.get(row.id)?.[0]?.area_scope ?? null,
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
      : db.from('social_profiles').select('id, handle, display_name, avatar_url, premium_verified, premium_featured_until, premium_label, is_system_account').in('id', authorIds),
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

  const authorMeta = new Map<string, { handle: string | null; display_name: string | null; avatar_url: string | null; premium_verified: boolean; premium_featured_until: string | null; premium_label: string | null; is_system_account: boolean }>()
  for (const row of authorRows.data ?? []) {
    const a = row as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; premium_verified?: boolean | null; premium_featured_until?: string | null; premium_label?: string | null; is_system_account?: boolean | null }
    authorMeta.set(a.id, {
      handle: a.handle,
      display_name: a.display_name,
      avatar_url: a.avatar_url ?? null,
      premium_verified: Boolean(a.premium_verified),
      premium_featured_until: a.premium_featured_until ?? null,
      premium_label: a.premium_label ?? null,
      is_system_account: Boolean(a.is_system_account),
    })
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
  const [tabs, viewer, candidates] = await Promise.all([
    getAllFeatures(),
    loadFeedViewerContext(),
    loadFeedCandidates(tab),
  ])
  if (viewer.profileId) {
    const premium = await getPremiumStatus(viewer.profileId).catch(() => null)
    if (premium) {
      viewer.hasPremium = premium.hasPremium
      viewer.premiumInfluenceEnabled = Boolean(premium.benefits.visibility_boost ?? premium.benefits.featured_placement ?? premium.benefits.badge)
      viewer.featuredInfluenceEnabled = Boolean(premium.benefits.featured_placement ?? premium.benefits.verified_tick)
      viewer.sponsorInfluenceEnabled = Boolean(tabs.sponsored_feed_enabled)
    }
  }
  let rankingSource = candidates
  if (viewer.profileId) {
    const decorations = await loadFeedDecorations(
      viewer.profileId,
      candidates.map((c) => c.id),
      candidates.map((c) => c.authorProfileId),
    )
    rankingSource = candidates.filter((candidate) => {
      if (shouldHidePromotionFromForYou(tab, candidate.postKind)) return false
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
      const author = decorations.authorMeta.get(candidate.authorProfileId)
      candidate.authorHandle = author?.handle ?? null
      candidate.authorDisplayName = author?.display_name ?? null
      candidate.authorAvatarUrl = author?.avatar_url ?? null
      candidate.authorIsSystemAccount = Boolean(author?.is_system_account)
      candidate.viewerHasLiked = decorations.likedPosts.has(candidate.id)
      candidate.viewerHasBookmarked = decorations.bookmarkedPosts.has(candidate.id)
      candidate.viewerHasReposted = decorations.repostedPosts.has(candidate.id)
      candidate.viewerFollowsAuthor = decorations.followedAuthors.has(candidate.authorProfileId)
      candidate.viewerMutedAuthor = decorations.mutedAuthors.has(candidate.authorProfileId)
      candidate.viewerBlockedAuthor = decorations.blockedAuthors.has(candidate.authorProfileId)
      candidate.isSponsored = decorations.activePromotions.has(candidate.id) || candidate.officialCollectionType === 'sponsored' || candidate.isSponsored
      candidate.isPremiumBoosted = Boolean(candidate.isPremiumBoosted || author?.premium_verified || (author?.premium_featured_until && new Date(author.premium_featured_until).getTime() > Date.now()))
      candidate.isFeatured = Boolean(candidate.isFeatured || (author?.premium_featured_until && new Date(author.premium_featured_until).getTime() > Date.now()))
      candidate.authorVerified = Boolean(author?.premium_verified)
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
