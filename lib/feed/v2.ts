import { createSupabaseAdmin } from '@/lib/supabase/server'
import { classifyDiscoveryTopics, getCampusDeals, getFeaturedVendors, getTrendingTopics } from '@/lib/feed/discovery'
import { formatOfficialFeedHeadline } from '@/lib/feed/display'
import { OFFICIAL_SYSTEM_AVATAR_URL } from '@/lib/feed/official-service'
import { loadFeedViewerContext } from '@/lib/feed/service'
import { formatPrice } from '@/lib/money'
import {
  canPublishFeedPost,
  resolveFeedPublisherKind,
  type FeedPermissionProfile,
  type FeedPermissionVendor,
} from '@/lib/feed/permissions'
import type { FeedV2Post, FeedV2RailCollection, FeedV2RailTopic, FeedV2RailVendor, FeedV2Story } from '@/app/feed-v2/fixtures'

export type FeedV2TabKey = 'for_you' | 'following' | 'nearby' | 'deals' | 'trending'

type LivePostRow = {
  id: string
  author_profile_id: string
  vendor_id: string | null
  related_menu_item_id: string | null
  related_promotion_ref: string | null
  post_kind: string
  status: string
  visibility: string
  body: string | null
  content_warning: string | null
  campus_id: string | null
  zone_id: string | null
  location_text: string | null
  hashtags_cached: string[] | null
  view_count: number | null
  like_count: number | null
  reply_count: number | null
  repost_count: number | null
  bookmark_count: number | null
  share_count: number | null
  menu_click_count: number | null
  cart_add_count: number | null
  order_count: number | null
  revenue_kobo: number | null
  watch_time_ms: number | null
  completion_rate: number | null
  safe_rank_score: number | null
  is_sponsored: boolean | null
  is_boosted: boolean | null
  is_archived: boolean | null
  published_at: string | null
  created_at: string
}

type LiveMediaRow = {
  id: string
  post_id: string
  media_kind: string
  public_url: string | null
  alt_text: string | null
  caption: string | null
  sort_order: number | null
  is_primary: boolean | null
  width: number | null
  height: number | null
}

type LiveMenuSnapshotRow = {
  id: string
  post_id: string
  menu_item_id: string
  menu_item_name_snapshot: string
  menu_item_price_kobo_snapshot: number
  is_available_snapshot: boolean
  is_primary: boolean | null
  menu_item_image_url_snapshot: string | null
}

type LiveOfficialRow = {
  post_id: string
  area_scope: 'city' | 'zone'
  area_id: string
  collection_type: string
  source_type: string
  source_id: string
  generation_reason: string
  selection_metadata: Record<string, unknown> | null
  is_auto_published: boolean
  approved_at: string | null
  approved_by: string | null
  archived_at: string | null
  archived_reason: string | null
}

type LiveStoryRow = {
  id: string
  author_profile_id: string
  post_id: string | null
  media_url: string | null
  media_kind: string
  caption: string | null
  status: string
  starts_at: string
  expires_at: string
  approved_at: string | null
  created_at: string
}

type LiveProfileRow = FeedPermissionProfile & {
  id: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  profile_kind: string | null
  official_badge_kind: string | null
  is_verified: boolean | null
  is_system_account: boolean | null
  premium_verified: boolean | null
  premium_featured_until: string | null
  premium_label: string | null
  vendor_id: string | null
  customer_id: string | null
  rider_id: string | null
  admin_id: string | null
  campus_id: string | null
  zone_id: string | null
}

type LiveVendorRow = FeedPermissionVendor & {
  id: string
  shop_name: string | null
  approval_state: string | null
  is_active: boolean | null
  is_verified: boolean | null
  business_verified: boolean | null
  id_verified: boolean | null
  avg_rating: number | null
  total_ratings: number | null
  opening_time: string | null
  closing_time: string | null
  city_id: string | null
  zone_id: string | null
}

type LiveMenuItemRow = {
  id: string
  vendor_id: string
  name: string
  price_kobo: number
  image_url: string | null
  is_available: boolean
  category: string | null
}

export interface FeedV2RightRailData {
  topics: FeedV2RailTopic[]
  vendors: FeedV2RailVendor[]
  collections: FeedV2RailCollection[]
}

export interface FeedV2SurfaceData {
  posts: FeedV2Post[]
  stories: FeedV2Story[]
  rightRail: FeedV2RightRailData
}

export type FeedV2SurfaceOptions = {
  tab?: FeedV2TabKey
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function timePartsInLagos(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function isWithinHours(now: Date, openingTime?: string | null, closingTime?: string | null) {
  if (!openingTime || !closingTime) return true
  const current = timePartsInLagos(now)
  if (openingTime <= closingTime) {
    return current >= openingTime && current < closingTime
  }
  return current >= openingTime || current < closingTime
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'Now'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Now'
  const diffMinutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (diffMinutes < 1) return 'Now'
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

function resolveStoryPublisherType(profile: LiveProfileRow | null | undefined, vendor: LiveVendorRow | null | undefined): FeedV2Story['publisherType'] {
  const kind = resolveFeedPublisherKind(profile, vendor)
  if (kind === 'official') return 'lumex'
  if (kind === 'verified_vendor') return 'vendor'
  if (kind === 'ambassador') return 'ambassador'
  return 'student'
}

function resolvePostPublisherType(profile: LiveProfileRow | null | undefined, vendor: LiveVendorRow | null | undefined): FeedV2Post['publisherType'] {
  const kind = resolveFeedPublisherKind(profile, vendor)
  if (kind === 'official') return 'official'
  if (kind === 'verified_vendor') return 'vendor'
  if (kind === 'ambassador') return 'ambassador'
  return 'student'
}

function resolveStoryMeta(
  publisherType: FeedV2Story['publisherType'],
  profile: LiveProfileRow | null | undefined,
  vendor: LiveVendorRow | null | undefined,
  publishedAt: string | null,
) {
  if (profile?.is_system_account || publisherType === 'lumex') return 'Official'
  if (publisherType === 'vendor') {
    if (vendor && isWithinHours(new Date(), vendor.opening_time, vendor.closing_time)) return 'Open now'
    return 'Vendor update'
  }
  if (publisherType === 'ambassador') return 'Campus drops'
  if (publisherType === 'super_admin') return 'Admin update'
  if (profile?.premium_label) return profile.premium_label
  return formatRelativeTime(publishedAt)
}

function resolveApprovalState(profile: LiveProfileRow | null | undefined, vendor: LiveVendorRow | null | undefined): FeedV2Story['approvalState'] {
  if (!profile) return 'pending'
  if (profile.is_system_account || profile.official_badge_kind === 'official') return 'approved'
  if (profile.profile_kind === 'vendor') {
    return vendor?.approval_state === 'approved' && vendor.is_active !== false ? 'approved' : 'pending'
  }
  if (profile.profile_kind === 'customer' && !profile.is_verified && !profile.premium_verified) return 'pending'
  return 'approved'
}

function isStoryEligibleProfile(profile: LiveProfileRow | null | undefined, vendor: LiveVendorRow | null | undefined) {
  return resolveFeedPublisherKind(profile, vendor) !== 'blocked'
}

function resolveDisplayName(profile: LiveProfileRow | null | undefined, vendor: LiveVendorRow | null | undefined) {
  const profileName = profile?.display_name?.trim()
  if (profileName) return profileName
  const vendorName = vendor?.shop_name?.trim()
  if (vendorName) return vendorName
  return 'LumeX Fud'
}

function resolveHandle(profile: LiveProfileRow | null | undefined, vendor: LiveVendorRow | null | undefined) {
  const handle = profile?.handle?.trim()
  if (handle) return handle
  if (vendor?.shop_name) {
    return vendor.shop_name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  }
  return 'lumex'
}

function engagementFields(row: LivePostRow) {
  return {
    viewCount: row.view_count ?? 0,
    likeCount: row.like_count ?? 0,
    replyCount: row.reply_count ?? 0,
    repostCount: row.repost_count ?? 0,
    saveCount: row.bookmark_count ?? 0,
    shareCount: row.share_count ?? 0,
  }
}

function mediaForStory(media: LiveMediaRow[] | undefined, menuItems: LiveMenuSnapshotRow[] | undefined) {
  const firstMedia = media?.find((item) => Boolean(item.public_url)) ?? null
  if (firstMedia?.public_url) return firstMedia.public_url
  const firstMenu = menuItems?.find((item) => Boolean(item.menu_item_image_url_snapshot)) ?? null
  return firstMenu?.menu_item_image_url_snapshot ?? null
}

function buildFeedPost(args: {
  row: LivePostRow
  profile: LiveProfileRow | null
  vendor: LiveVendorRow | null
  media: LiveMediaRow[]
  menuItems: LiveMenuSnapshotRow[]
  liveMenuItem: LiveMenuItemRow | null
  official: LiveOfficialRow | null
}): FeedV2Post | null {
  const { row, profile, vendor, media, menuItems, liveMenuItem, official } = args
  if (!canPublishFeedPost(profile, vendor)) return null
  const displayName = resolveDisplayName(profile, vendor)
  const handle = resolveHandle(profile, vendor)
  const avatar = profile?.avatar_url ?? null
  const storyImage = mediaForStory(media, menuItems)
  const publisherType = resolvePostPublisherType(profile, vendor)
  const approved = resolveApprovalState(profile, vendor)
  const officialHeadline = official ? formatOfficialFeedHeadline(official.collection_type as Parameters<typeof formatOfficialFeedHeadline>[0]) : null
  const primaryMedia = media
    .slice()
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .find((item) => Boolean(item.public_url))

  const statusPills: string[] = []
  const isVendorOpen = Boolean(vendor && isWithinHours(new Date(), vendor.opening_time, vendor.closing_time))
  if (publisherType === 'vendor') {
    if (isVendorOpen) statusPills.push('Open now')
    if (approved === 'approved') statusPills.push('Verified vendor')
  } else if (publisherType === 'ambassador') {
    statusPills.push('Campus update')
  } else {
    statusPills.push('Live now')
  }

  const menuEntry = menuItems.find((item) => item.is_primary) ?? menuItems[0] ?? null
  const liveMenuPrice = liveMenuItem ? formatPrice(liveMenuItem.price_kobo) : null
  const menuEntryName = menuEntry ? menuEntry.menu_item_name_snapshot : null
  const liveMenuName = liveMenuItem ? liveMenuItem.name : null
  const hasOrderableMenu = Boolean((menuEntry?.is_available_snapshot ?? false) || liveMenuItem?.is_available)
  const body = row.body?.trim() ?? menuEntry?.menu_item_name_snapshot ?? officialHeadline ?? 'New post'
  const area = row.location_text?.trim()
    || vendor?.zone_id
    || vendor?.city_id
    || 'Campus'

  if (official) {
    const collectionType = official.collection_type
    const isCollection = !['sponsored', 'event'].includes(collectionType) && menuItems.length > 1
    const image = storyImage ?? primaryMedia?.public_url ?? null
    const title = officialHeadline ?? displayName

    if (isCollection) {
      return {
        kind: 'collection',
        id: row.id,
        authorProfileId: row.author_profile_id,
        author: 'LumeX Fud',
        handle: 'lumex',
        area,
        campusId: row.campus_id ?? undefined,
        zoneId: row.zone_id ?? undefined,
        time: formatRelativeTime(row.published_at),
        title,
        body: row.body?.trim() ?? official.generation_reason,
        items: menuItems.slice(0, 4).map((item) => ({
          name: item.menu_item_name_snapshot,
          vendor: displayName,
          price: formatPrice(item.menu_item_price_kobo_snapshot),
          image: item.menu_item_image_url_snapshot ?? image ?? '/icons/icon-512-v2.png',
          available: item.is_available_snapshot,
        })),
        avatar: image ?? avatar ?? undefined,
        tags: row.hashtags_cached ?? undefined,
        verified: true,
        statusPills,
        ctaLabel: 'See Available Vendors',
        ...engagementFields(row),
        publisherType: 'official',
        approvalState: 'approved',
      }
    }

    return {
      kind: 'official',
      id: row.id,
      authorProfileId: row.author_profile_id,
      author: 'LumeX Fud',
      handle: 'lumex',
      area,
      campusId: row.campus_id ?? undefined,
      zoneId: row.zone_id ?? undefined,
      time: formatRelativeTime(row.published_at),
      title,
      body: row.body?.trim() ?? official.generation_reason,
      image: image ?? undefined,
      officialNote: official.generation_reason,
      avatar: avatar ?? undefined,
      tags: row.hashtags_cached ?? undefined,
      verified: true,
      statusPills,
      ctaLabel: undefined,
      ...engagementFields(row),
      publisherType: 'official',
      approvalState: 'approved',
    }
  }

  if (menuEntry || liveMenuItem) {
    const image = menuEntry?.menu_item_image_url_snapshot ?? liveMenuItem?.image_url ?? storyImage ?? '/icons/icon-192-v2.png'
    const price = liveMenuPrice ?? formatPrice(menuEntry?.menu_item_price_kobo_snapshot ?? liveMenuItem?.price_kobo ?? 0)
    const available = menuEntry ? menuEntry.is_available_snapshot : Boolean(liveMenuItem?.is_available)
    return {
      kind: 'menu',
      id: row.id,
      authorProfileId: row.author_profile_id,
      author: displayName,
      handle,
      area,
      campusId: row.campus_id ?? undefined,
      zoneId: row.zone_id ?? undefined,
      time: formatRelativeTime(row.published_at),
      body,
      avatar: avatar ?? undefined,
      tags: row.hashtags_cached ?? undefined,
      verified: approved === 'approved',
      statusPills: available ? statusPills : ['Currently unavailable', ...statusPills.slice(0, 1)],
      ctaLabel: available ? 'Order Now' : undefined,
      ...engagementFields(row),
      item: {
        name: menuEntryName ?? liveMenuName ?? body,
        vendor: displayName,
        price,
        image,
        available,
      },
      publisherType,
      approvalState: approved,
      linkedVendor: vendor?.shop_name ?? undefined,
      linkedMenuItem: menuEntryName ?? liveMenuName ?? undefined,
    }
  }

  const mediaKind = primaryMedia?.media_kind ?? (row.post_kind === 'VIDEO' || row.post_kind === 'TIKTOK' ? 'video' : 'image')
  const ratio = primaryMedia?.width && primaryMedia?.height
    ? (primaryMedia.width > primaryMedia.height ? 'wide' : primaryMedia.width < primaryMedia.height ? 'portrait' : 'square')
    : (mediaKind === 'video' ? 'portrait' : row.post_kind === 'MEME' ? 'square' : 'wide')

  const mediaItems = media
    .filter((item) => Boolean(item.public_url))
    .slice(0, 4)
    .map((item) => ({
      src: item.public_url ?? '',
      kind: item.media_kind === 'video' ? 'video' as const : 'image' as const,
      overlayText: item.caption ?? item.alt_text ?? undefined,
    }))

  const bodyKind: FeedV2Post['kind'] = mediaKind === 'video' ? 'video' : row.post_kind === 'IMAGE' || row.post_kind === 'TIKTOK' ? 'image' : 'meme'
  const postMedia = mediaItems.length > 0 ? mediaItems : primaryMedia?.public_url ? [{
    src: primaryMedia.public_url,
    kind: mediaKind === 'video' ? 'video' as const : 'image' as const,
    overlayText: primaryMedia.caption ?? primaryMedia.alt_text ?? undefined,
  }] : []

  if ((bodyKind === 'video' || bodyKind === 'image' || bodyKind === 'meme') && postMedia.length > 0) {
    return {
      kind: bodyKind,
      id: row.id,
      authorProfileId: row.author_profile_id,
      author: displayName,
      handle,
      area,
      campusId: row.campus_id ?? undefined,
      zoneId: row.zone_id ?? undefined,
      time: formatRelativeTime(row.published_at),
      body,
      image: primaryMedia?.public_url ?? postMedia[0]?.src ?? '',
      ratio,
      media: postMedia,
      avatar: avatar ?? undefined,
      tags: row.hashtags_cached ?? undefined,
      verified: approved === 'approved',
      statusPills,
      ctaLabel: hasOrderableMenu ? 'Order Now' : undefined,
      ...engagementFields(row),
      publisherType,
      approvalState: approved,
      linkedVendor: vendor?.shop_name ?? undefined,
      linkedMenuItem: menuEntryName ?? liveMenuName ?? undefined,
    }
  }

  return {
    kind: 'text',
    id: row.id,
    authorProfileId: row.author_profile_id,
    author: displayName,
    handle,
    area,
    campusId: row.campus_id ?? undefined,
    zoneId: row.zone_id ?? undefined,
    time: formatRelativeTime(row.published_at),
    body,
    avatar: avatar ?? undefined,
    tags: row.hashtags_cached ?? undefined,
    verified: approved === 'approved',
    statusPills,
    ctaLabel: undefined,
    ...engagementFields(row),
    publisherType,
    approvalState: approved,
    linkedVendor: vendor?.shop_name ?? undefined,
    linkedMenuItem: menuEntryName ?? liveMenuName ?? undefined,
  }
}

function buildStory(args: {
  row: LiveStoryRow
  profile: LiveProfileRow | null
  vendor: LiveVendorRow | null
}): FeedV2Story | null {
  const { row, profile, vendor } = args
  const caption = row.caption?.trim() ?? ''
  if ((!row.media_url && !caption) || !isStoryEligibleProfile(profile, vendor)) return null

  const publisherType = resolveStoryPublisherType(profile, vendor)
  const approved = row.status === 'published' ? 'approved' : resolveApprovalState(profile, vendor)
  const label = resolveDisplayName(profile, vendor)
  const isLive = publisherType === 'vendor'
    ? Boolean(vendor && isWithinHours(new Date(), vendor.opening_time, vendor.closing_time))
    : Boolean(row.starts_at && (Date.now() - new Date(row.starts_at).getTime()) <= 6 * 3_600_000)

  return {
    label,
    meta: resolveStoryMeta(publisherType, profile, vendor, row.starts_at),
    avatarUrl: profile?.avatar_url ?? (publisherType === 'lumex' ? OFFICIAL_SYSTEM_AVATAR_URL : null),
    image: row.media_url,
    mediaKind: row.media_kind === 'video' ? 'video' : 'image',
    text: caption || null,
    live: isLive || publisherType === 'lumex',
    active: Boolean(row.starts_at && (Date.now() - new Date(row.starts_at).getTime()) <= 90 * 60 * 1000),
    publisherType,
    approvalState: approved,
  }
}

function buildStoryFromPost(args: {
  row: LivePostRow
  profile: LiveProfileRow | null
  vendor: LiveVendorRow | null
  media: LiveMediaRow[]
}): FeedV2Story | null {
  const { row, profile, vendor, media } = args
  if (!isStoryEligibleProfile(profile, vendor)) return null

  const image = media
    .slice()
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .find((item) => Boolean(item.public_url))?.public_url

  if (!image) return null

  const publisherType = resolveStoryPublisherType(profile, vendor)
  const approved = resolveApprovalState(profile, vendor)
  const label = resolveDisplayName(profile, vendor)
  const isLive = publisherType === 'vendor'
    ? Boolean(vendor && isWithinHours(new Date(), vendor.opening_time, vendor.closing_time))
    : Boolean(row.published_at && (Date.now() - new Date(row.published_at).getTime()) <= 6 * 3_600_000)

  return {
    label,
    meta: resolveStoryMeta(publisherType, profile, vendor, row.published_at),
    avatarUrl: profile?.avatar_url ?? (publisherType === 'lumex' ? OFFICIAL_SYSTEM_AVATAR_URL : null),
    image,
    mediaKind: 'image',
    live: isLive || publisherType === 'lumex',
    active: Boolean(row.published_at && (Date.now() - new Date(row.published_at).getTime()) <= 90 * 60 * 1000),
    publisherType,
    approvalState: approved,
  }
}

function buildStoriesFromRecentPosts(args: {
  rows: LivePostRow[]
  profileById: Map<string, LiveProfileRow>
  vendorById: Map<string, LiveVendorRow>
  mediaByPostId: Map<string, LiveMediaRow[]>
  limit?: number
}) {
  const { rows, profileById, vendorById, mediaByPostId, limit = 12 } = args
  const seenAuthors = new Set<string>()
  const stories: FeedV2Story[] = []

  for (const row of rows) {
    if (!row.published_at) continue
    if ((Date.now() - new Date(row.published_at).getTime()) > 24 * 3_600_000) continue
    if (seenAuthors.has(row.author_profile_id)) continue

    const profile = profileById.get(row.author_profile_id) ?? null
    const vendor = profile?.vendor_id
      ? vendorById.get(profile.vendor_id) ?? null
      : vendorById.get(row.vendor_id ?? '') ?? null
    const story = buildStoryFromPost({
      row,
      profile,
      vendor,
      media: mediaByPostId.get(row.id) ?? [],
    })

    if (!story) continue
    stories.push(story)
    seenAuthors.add(row.author_profile_id)
    if (stories.length >= limit) break
  }

  return stories
}

async function loadFeedStories(db: ReturnType<typeof createSupabaseAdmin>, limit = 12): Promise<FeedV2Story[]> {
  const now = new Date().toISOString()
  const { data: storyRows, error } = await db
    .from('feed_stories')
    .select('id, author_profile_id, post_id, media_url, media_kind, caption, status, starts_at, expires_at, approved_at, created_at')
    .eq('status', 'published')
    .lte('starts_at', now)
    .gt('expires_at', now)
    .is('archived_at', null)
    .order('starts_at', { ascending: false })
    .limit(limit * 3)

  if (error) {
    console.error('[feed-v2] stories load failed:', error.message)
    return []
  }

  const rows = (storyRows ?? []) as LiveStoryRow[]
  const authorIds = unique(rows.map((row) => row.author_profile_id))
  if (authorIds.length === 0) return []

  const { data: profileRows, error: profileError } = await db
    .from('social_profiles')
    .select('id, handle, display_name, avatar_url, profile_kind, official_badge_kind, is_verified, is_system_account, premium_verified, premium_featured_until, premium_label, vendor_id, customer_id, rider_id, admin_id, campus_id, zone_id')
    .in('id', authorIds)

  if (profileError) {
    console.error('[feed-v2] story profiles load failed:', profileError.message)
    return []
  }

  const profileById = new Map<string, LiveProfileRow>()
  for (const row of (profileRows ?? []) as LiveProfileRow[]) {
    profileById.set(row.id, row)
  }

  const storyVendorIds = unique((profileRows ?? []).map((profile) => (profile as LiveProfileRow).vendor_id))
  const { data: vendorRows, error: vendorError } = storyVendorIds.length > 0
    ? await db
        .from('vendors')
        .select('id, shop_name, approval_state, is_active, is_verified, business_verified, id_verified, avg_rating, total_ratings, opening_time, closing_time, city_id, zone_id')
        .in('id', storyVendorIds)
    : { data: [], error: null }

  if (vendorError) {
    console.error('[feed-v2] story vendors load failed:', vendorError.message)
    return []
  }

  const vendorById = new Map<string, LiveVendorRow>()
  for (const row of (vendorRows ?? []) as LiveVendorRow[]) {
    vendorById.set(row.id, row)
  }

  const stories: FeedV2Story[] = []
  const seenAuthors = new Set<string>()
  for (const row of rows) {
    if (seenAuthors.has(row.author_profile_id)) continue
    const profile = profileById.get(row.author_profile_id) ?? null
    const vendor = profile?.vendor_id ? vendorById.get(profile.vendor_id) ?? null : null
    const story = buildStory({ row, profile, vendor })
    if (!story) continue
    stories.push(story)
    seenAuthors.add(row.author_profile_id)
    if (stories.length >= limit) break
  }

  return stories
}

function buildRightRail(items: FeedV2Post[]): FeedV2RightRailData {
  const realisticTopicFallbacks = ['#jollof', '#shawarma', '#latenight', '#breakfast', '#absu']
  const normalizeTopicLabel = (label: string, index: number) => {
    const normalized = label.toLowerCase().replace(/^#/, '')
    if (['flyer', 'promo', 'preview', 'test', 'demo'].includes(normalized)) {
      return realisticTopicFallbacks[index % realisticTopicFallbacks.length] ?? '#jollof'
    }
    return label.startsWith('#') ? label : `#${label.replace(/^#/, '')}`
  }

  const discoveryItems = items.map((item) => ({
    authorDisplayName: item.author,
    authorHandle: item.handle,
    hashtags: item.tags ?? null,
    postKind: item.kind === 'official' || item.kind === 'collection' ? 'PROMOTION' : item.kind === 'menu' ? 'MENU_ITEM' : item.kind.toUpperCase(),
    body: item.body ?? null,
    image:
      item.kind === 'menu'
        ? item.item.image
        : item.kind === 'collection'
          ? item.items[0]?.image ?? null
          : item.kind === 'official'
            ? item.image ?? null
            : 'image' in item
              ? item.image ?? null
              : null,
    menuItems: item.kind === 'menu' ? [{
      name: item.item.name,
      priceKobo: typeof item.item.price === 'string' ? Number(item.item.price.replace(/[^\d]/g, '')) * 100 : null,
      isPrimary: true,
    }] : item.kind === 'collection'
      ? item.items.map((menu) => ({
          name: menu.name,
          priceKobo: Number(menu.price.replace(/[^\d]/g, '')) * 100,
          isPrimary: true,
        }))
      : null,
  }))

  const trending = getTrendingTopics(discoveryItems, 3)
  const featured = getFeaturedVendors(discoveryItems, 3)
  const deals = getCampusDeals(discoveryItems, 3)

  const topicRows = trending.map((topic, index) => {
    const source = discoveryItems.find((item) => (item.hashtags ?? []).some((tag) => `#${String(tag).replace(/^#/, '')}`.toLowerCase() === topic.label.toLowerCase()))
      ?? discoveryItems.find((item) => classifyDiscoveryTopics(item).length > 0)
    return {
      label: normalizeTopicLabel(topic.label, index),
      meta: `${topic.count} posts today`,
      image: source?.image ?? '/premium/dish-1.jpg',
    }
  })

  return {
    topics: topicRows,
    vendors: featured.map((vendor, index) => ({
      name: vendor.name,
      meta: `${vendor.count} posts`,
      image: ['/premium/dish-1.jpg', '/premium/dish-2.jpg', '/premium/dish-3.jpg'][index % 3] ?? '/premium/dish-1.jpg',
    })),
    collections: deals.map((deal) => ({
      title: deal.title,
      meta: `${deal.vendor} · ${deal.badge}`,
    })),
  }
}

function tabToKey(tab?: FeedV2TabKey) {
  return tab ?? 'for_you'
}

async function filterPostsForTab(
  db: ReturnType<typeof createSupabaseAdmin>,
  posts: FeedV2Post[],
  tab: FeedV2TabKey,
  viewer: Awaited<ReturnType<typeof loadFeedViewerContext>>,
) {
  if (tab === 'for_you') return posts
  if (tab === 'deals') {
    return posts.filter((post) => Boolean(post.ctaLabel))
  }
  if (tab === 'trending') {
    return posts
      .slice()
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
  }
  if (tab === 'nearby') {
    if (!viewer.profileId) return []
    return posts.filter((post) => {
      const zoneMatch = viewer.zoneId && 'zoneId' in post && String(post.zoneId) === viewer.zoneId
      const campusMatch = viewer.campusId && 'campusId' in post && String(post.campusId) === viewer.campusId
      return Boolean(zoneMatch || campusMatch || post.area === 'Campus')
    })
  }
  if (tab === 'following') {
    if (!viewer.profileId) return []
    const authorIds = unique(posts.map((post) => post.authorProfileId))
    if (authorIds.length === 0) return []
    const { data } = await db
      .from('follows')
      .select('followed_profile_id')
      .eq('follower_profile_id', viewer.profileId)
      .in('followed_profile_id', authorIds)
    const followed = new Set((data ?? []).map((row) => String((row as { followed_profile_id: string }).followed_profile_id)))
    return posts.filter((post) => Boolean(
      post.kind === 'official'
      || post.kind === 'collection'
      || post.author === 'LumeX Fud'
      || (post.authorProfileId && followed.has(post.authorProfileId)),
    ))
  }
  return posts
}

async function applyViewerFollowState(
  db: ReturnType<typeof createSupabaseAdmin>,
  posts: FeedV2Post[],
  viewer: Awaited<ReturnType<typeof loadFeedViewerContext>>,
) {
  if (!viewer.profileId) return posts
  const authorIds = unique(posts.map((post) => post.authorProfileId))
  const postIds = posts.map((post) => post.id)
  if (authorIds.length === 0 && postIds.length === 0) return posts
  const loadPostIds = async (table: 'post_likes' | 'bookmarks' | 'reposts') => {
    if (postIds.length === 0) return new Set<string>()
    const { data } = await db
      .from(table)
      .select('post_id')
      .eq('profile_id', viewer.profileId)
      .in('post_id', postIds)
    return new Set((data ?? []).map((row) => String((row as { post_id: string }).post_id)))
  }
  const [followRows, likedPosts, savedPosts, repostedPosts] = await Promise.all([
    authorIds.length === 0
      ? Promise.resolve({ data: [] })
      : db
          .from('follows')
          .select('followed_profile_id')
          .eq('follower_profile_id', viewer.profileId)
          .in('followed_profile_id', authorIds),
    loadPostIds('post_likes'),
    loadPostIds('bookmarks'),
    loadPostIds('reposts'),
  ])
  const followed = new Set((followRows.data ?? []).map((row) => String((row as { followed_profile_id: string }).followed_profile_id)))
  return posts.map((post) => ({
    ...post,
    viewerFollows: Boolean(post.authorProfileId && followed.has(post.authorProfileId)),
    viewerLiked: likedPosts.has(post.id),
    viewerSaved: savedPosts.has(post.id),
    viewerReposted: repostedPosts.has(post.id),
  }))
}

export async function loadFeedV2Surface(options: FeedV2SurfaceOptions = {}): Promise<FeedV2SurfaceData> {
  const db = createSupabaseAdmin()
  const tab = tabToKey(options.tab)
  const viewer = await loadFeedViewerContext()
  const { data: postRows, error } = await db
    .from('posts')
    .select('id, author_profile_id, vendor_id, related_menu_item_id, related_promotion_ref, post_kind, status, visibility, body, content_warning, campus_id, zone_id, location_text, hashtags_cached, view_count, like_count, reply_count, repost_count, bookmark_count, share_count, menu_click_count, cart_add_count, order_count, revenue_kobo, watch_time_ms, completion_rate, safe_rank_score, is_sponsored, is_boosted, is_archived, published_at, created_at')
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(24)

  if (error) throw new Error(error.message)

  const rows = (postRows ?? []) as LivePostRow[]
  const postIds = rows.map((row) => row.id)
  const authorIds = unique(rows.map((row) => row.author_profile_id))
  const vendorIds = unique(rows.map((row) => row.vendor_id))
  const menuIds = unique(rows.map((row) => row.related_menu_item_id))

  const [mediaResult, menuResult, officialResult, profileResult, vendorResult, liveMenuResult] = await Promise.all([
    postIds.length > 0
      ? db.from('post_media').select('id, post_id, media_kind, public_url, alt_text, caption, sort_order, is_primary, width, height').in('post_id', postIds)
      : Promise.resolve({ data: [] }),
    postIds.length > 0
      ? db.from('post_menu_items').select('id, post_id, menu_item_id, menu_item_name_snapshot, menu_item_price_kobo_snapshot, is_available_snapshot, is_primary, menu_item_image_url_snapshot').in('post_id', postIds)
      : Promise.resolve({ data: [] }),
    postIds.length > 0
      ? db.from('official_feed_posts').select('post_id, area_scope, area_id, collection_type, source_type, source_id, generation_reason, selection_metadata, is_auto_published, approved_at, approved_by, archived_at, archived_reason').in('post_id', postIds)
      : Promise.resolve({ data: [] }),
    authorIds.length > 0
      ? db.from('social_profiles').select('id, handle, display_name, avatar_url, profile_kind, official_badge_kind, is_verified, is_system_account, premium_verified, premium_featured_until, premium_label, vendor_id, customer_id, rider_id, admin_id, campus_id, zone_id').in('id', authorIds)
      : Promise.resolve({ data: [] }),
    vendorIds.length > 0
      ? db.from('vendors').select('id, shop_name, approval_state, is_active, is_verified, business_verified, id_verified, avg_rating, total_ratings, opening_time, closing_time, city_id, zone_id').in('id', vendorIds)
      : Promise.resolve({ data: [] }),
    menuIds.length > 0
      ? db.from('menu_items').select('id, vendor_id, name, price_kobo, image_url, is_available, category').in('id', menuIds)
      : Promise.resolve({ data: [] }),
  ])

  const mediaByPostId = new Map<string, LiveMediaRow[]>()
  for (const row of (mediaResult.data ?? []) as LiveMediaRow[]) {
    const list = mediaByPostId.get(row.post_id) ?? []
    list.push(row)
    mediaByPostId.set(row.post_id, list)
  }

  const menuByPostId = new Map<string, LiveMenuSnapshotRow[]>()
  for (const row of (menuResult.data ?? []) as LiveMenuSnapshotRow[]) {
    const list = menuByPostId.get(row.post_id) ?? []
    list.push(row)
    menuByPostId.set(row.post_id, list)
  }

  const officialByPostId = new Map<string, LiveOfficialRow>()
  for (const row of (officialResult.data ?? []) as LiveOfficialRow[]) {
    officialByPostId.set(row.post_id, row)
  }

  const profileById = new Map<string, LiveProfileRow>()
  for (const row of (profileResult.data ?? []) as LiveProfileRow[]) {
    profileById.set(row.id, row)
  }

  const vendorById = new Map<string, LiveVendorRow>()
  for (const row of (vendorResult.data ?? []) as LiveVendorRow[]) {
    vendorById.set(row.id, row)
  }

  const liveMenuById = new Map<string, LiveMenuItemRow>()
  for (const row of (liveMenuResult.data ?? []) as LiveMenuItemRow[]) {
    liveMenuById.set(row.id, row)
  }

  const posts = rows
    .map((row) => buildFeedPost({
      row,
      profile: profileById.get(row.author_profile_id) ?? null,
      vendor: vendorById.get(row.vendor_id ?? '') ?? null,
      media: mediaByPostId.get(row.id) ?? [],
      menuItems: menuByPostId.get(row.id) ?? [],
      liveMenuItem: row.related_menu_item_id ? liveMenuById.get(row.related_menu_item_id) ?? null : null,
      official: officialByPostId.get(row.id) ?? null,
    }))
    .filter((item): item is FeedV2Post => Boolean(item))

  const postsWithFollowState = await applyViewerFollowState(db, posts, viewer)
  const visiblePosts = await filterPostsForTab(db, postsWithFollowState, tab, viewer)
  const rightRail = buildRightRail(visiblePosts)
  const stories = await loadFeedStories(db)
  const liveStories = stories.length > 0
    ? stories
    : buildStoriesFromRecentPosts({ rows, profileById, vendorById, mediaByPostId })

  return {
    posts: visiblePosts,
    stories: liveStories,
    rightRail,
  }
}
