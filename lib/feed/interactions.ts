import { createSupabaseAdmin } from '@/lib/supabase/server'
import { ensureSocialProfileForSession } from './service'
import { loadRecipientsFromProfileIds, notifyFeedRecipients } from './notifications'
import {
  canPublishFeedPost,
  isOfficialFeedProfile,
  loadFeedPermissionContext,
  type FeedPermissionProfile,
} from './permissions'

export type FeedToggleState = {
  enabled: boolean
  count: number
}

export type FeedRelationState = FeedToggleState

export interface FeedTargetPost {
  id: string
  author_profile_id: string
  status: string
  deleted_at: string | null
  is_archived: boolean | null
}

async function requireProfile() {
  const profile = await ensureSocialProfileForSession()
  if (!profile?.id) throw new Error('Could not resolve social profile')
  return profile
}

async function loadTargetPost(db: ReturnType<typeof createSupabaseAdmin>, postId: string): Promise<FeedTargetPost> {
  const { data } = await db
    .from('posts')
    .select('id, author_profile_id, status, deleted_at, is_archived')
    .eq('id', postId)
    .maybeSingle()
  if (!data) throw new Error('Post not found')
  return data as FeedTargetPost
}

async function countRows(db: ReturnType<typeof createSupabaseAdmin>, table: string, column: string, value: string): Promise<number> {
  const { count } = await db.from(table).select(column, { count: 'exact', head: true }).eq(column, value)
  return count ?? 0
}

async function updatePostCount(db: ReturnType<typeof createSupabaseAdmin>, postId: string, column: 'like_count' | 'reply_count' | 'repost_count' | 'bookmark_count') {
  let table = 'post_likes'
  if (column === 'reply_count') table = 'post_replies'
  else if (column === 'repost_count') table = 'reposts'
  else if (column === 'bookmark_count') table = 'bookmarks'
  const countColumn = column === 'reply_count' ? 'post_id' : 'post_id'
  const count = await countRows(db, table, countColumn, postId)
  await db.from('posts').update({ [column]: count, updated_at: new Date().toISOString() }).eq('id', postId)
  return count
}

async function upsertToggle(
  db: ReturnType<typeof createSupabaseAdmin>,
  table: string,
  profileColumn: string,
  postColumn: string,
  profileId: string,
  postId: string,
  enabled: boolean,
): Promise<boolean> {
  if (enabled) {
    const insertPayload: Record<string, unknown> = { [profileColumn]: profileId, [postColumn]: postId }
    const { error } = await db.from(table).insert(insertPayload)
    if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
    return true
  }

  await db.from(table).delete().eq(profileColumn, profileId).eq(postColumn, postId)
  return false
}

export async function toggleLike(postId: string, enabled: boolean) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status !== 'published') throw new Error('Post is not available')
  const liked = await upsertToggle(db, 'post_likes', 'profile_id', 'post_id', profile.id, postId, enabled)
  const likeCount = await updatePostCount(db, postId, 'like_count')
  return { postId, liked, likeCount }
}

export async function toggleBookmark(postId: string, enabled: boolean) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status !== 'published') throw new Error('Post is not available')
  const bookmarked = await upsertToggle(db, 'bookmarks', 'profile_id', 'post_id', profile.id, postId, enabled)
  const saveCount = await updatePostCount(db, postId, 'bookmark_count')
  return { postId, bookmarked, saveCount }
}

export async function toggleRepost(postId: string, enabled: boolean) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status !== 'published') throw new Error('Post is not available')
  const reposted = await upsertToggle(db, 'reposts', 'profile_id', 'post_id', profile.id, postId, enabled)
  const repostCount = await updatePostCount(db, postId, 'repost_count')
  return { postId, reposted, repostCount }
}

export async function toggleFollow(followedProfileId: string, enabled: boolean) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  if (profile.id === followedProfileId) throw new Error('You cannot follow yourself')
  const { data: target } = await db
    .from('social_profiles')
    .select('id, deleted_at, profile_kind, is_verified, is_system_account, official_badge_kind, premium_verified, premium_label, vendor_id')
    .eq('id', followedProfileId)
    .maybeSingle()
  if (!target) throw new Error('Profile not found')
  const targetProfile = target as FeedPermissionProfile & { deleted_at?: string | null }
  if (targetProfile.deleted_at) throw new Error('Profile not found')
  if (isOfficialFeedProfile(targetProfile) && !enabled) {
    return { followedProfileId, followed: true, followCount: await countRows(db, 'follows', 'followed_profile_id', followedProfileId) }
  }
  const [outgoingBlock, incomingBlock] = await Promise.all([
    db.from('blocks').select('id').eq('blocker_profile_id', profile.id).eq('blocked_profile_id', followedProfileId).maybeSingle(),
    db.from('blocks').select('id').eq('blocker_profile_id', followedProfileId).eq('blocked_profile_id', profile.id).maybeSingle(),
  ])
  if (outgoingBlock.data || incomingBlock.data) throw new Error('You cannot follow a blocked profile')
  const followed = await upsertToggle(db, 'follows', 'follower_profile_id', 'followed_profile_id', profile.id, followedProfileId, enabled)
  const followCount = await countRows(db, 'follows', 'followed_profile_id', followedProfileId)
  if (enabled) {
    void (async () => {
      const recipients = await loadRecipientsFromProfileIds([followedProfileId])
      await notifyFeedRecipients({ recipients, title: 'New follower', body: 'Someone started following your profile.', link: '/feed-v2', template: 'FEED_NEW_FOLLOWER', tag: `feed-follow-${profile.id}-${followedProfileId}` })
    })().catch(() => {})
  }
  return { followedProfileId, followed, followCount }
}

export async function toggleMute(mutedProfileId: string, enabled: boolean) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  if (profile.id === mutedProfileId) throw new Error('You cannot mute yourself')
  const { data: target } = await db.from('social_profiles').select('id, deleted_at, is_system_account, official_badge_kind').eq('id', mutedProfileId).maybeSingle()
  if (!target) throw new Error('Profile not found')
  if ((target as { is_system_account?: boolean; official_badge_kind?: string }).is_system_account || (target as { official_badge_kind?: string }).official_badge_kind === 'official') throw new Error('The LumeX Fud account cannot be muted')
  const muted = await upsertToggle(db, 'mutes', 'muter_profile_id', 'muted_profile_id', profile.id, mutedProfileId, enabled)
  return { mutedProfileId, muted }
}

export async function toggleBlock(blockedProfileId: string, enabled: boolean, reason?: string) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  if (profile.id === blockedProfileId) throw new Error('You cannot block yourself')
  const { data: target } = await db.from('social_profiles').select('id, deleted_at, is_system_account, official_badge_kind').eq('id', blockedProfileId).maybeSingle()
  if (!target) throw new Error('Profile not found')
  if ((target as { is_system_account?: boolean; official_badge_kind?: string }).is_system_account || (target as { official_badge_kind?: string }).official_badge_kind === 'official') throw new Error('The LumeX Fud account cannot be blocked')
  if (enabled) {
    const { error } = await db.from('blocks').insert({ blocker_profile_id: profile.id, blocked_profile_id: blockedProfileId, reason: reason ?? null })
    if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
  } else {
    await db.from('blocks').delete().eq('blocker_profile_id', profile.id).eq('blocked_profile_id', blockedProfileId)
  }
  return { blockedProfileId, blocked: enabled }
}

export async function createReply(postId: string, body: string, parentReplyId?: string) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status !== 'published') throw new Error('Post is not available')
  const now = new Date().toISOString()
  const { data, error } = await db.from('post_replies').insert({
    post_id: postId,
    author_profile_id: profile.id,
    parent_reply_id: parentReplyId ?? null,
    body,
    status: 'published',
    updated_at: now,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create reply')
  const replyCount = await countRows(db, 'post_replies', 'post_id', postId)
  await db.from('posts').update({ reply_count: replyCount, updated_at: now }).eq('id', postId)
  const recipientProfileIds: string[] = []
  if (parentReplyId) {
    const { data: parentReply } = await db
      .from('post_replies')
      .select('author_profile_id')
      .eq('id', parentReplyId)
      .maybeSingle()
    const parentAuthorProfileId = (parentReply as { author_profile_id?: string } | null)?.author_profile_id
    if (parentAuthorProfileId && parentAuthorProfileId !== profile.id) recipientProfileIds.push(parentAuthorProfileId)
  } else if (post.author_profile_id !== profile.id) {
    recipientProfileIds.push(post.author_profile_id)
  }
  if (recipientProfileIds.length > 0) {
    const recipients = await loadRecipientsFromProfileIds(recipientProfileIds)
    await notifyFeedRecipients({
      recipients,
      title: parentReplyId ? 'Reply to your comment' : 'New comment on your post',
      body: parentReplyId ? 'Someone replied to your comment.' : 'Someone commented on your post.',
      link: '/feed',
      template: parentReplyId ? 'FEED_COMMENT_REPLY' : 'FEED_POST_COMMENT',
      tag: `feed-reply-${postId}-${String((data as { id: string }).id)}`,
    })
  }
  return { postId, replyId: String((data as { id: string }).id), replyCount }
}

export async function createQuote(postId: string, body: string) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const permissionContext = await loadFeedPermissionContext(db, profile.id)
  if (!canPublishFeedPost(permissionContext.profile, permissionContext.vendor)) {
    throw new Error('Only verified vendors, approved ambassadors, and official accounts can quote posts')
  }
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status !== 'published') throw new Error('Post is not available')
  const now = new Date().toISOString()
  const { data, error } = await db.from('posts').insert({
    author_profile_id: profile.id,
    post_kind: 'QUOTE',
    status: 'published',
    visibility: 'public',
    audience_scope: 'all',
    body,
    quoted_post_id: postId,
    published_at: now,
    updated_at: now,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create quote')
  return { postId: String((data as { id: string }).id), quotedPostId: postId }
}

export async function createReport(postId: string, reportType: string, reason: string) {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status === 'deleted') throw new Error('Post is not available')
  const { data: postAuthor } = await db.from('social_profiles').select('is_system_account, official_badge_kind').eq('id', post.author_profile_id).maybeSingle()
  if ((postAuthor as { is_system_account?: boolean } | null)?.is_system_account || (postAuthor as { official_badge_kind?: string } | null)?.official_badge_kind === 'official') throw new Error('Official LumeX Fud posts cannot be reported here')
  const now = new Date().toISOString()
  const existingKey = `${profile.id}:${postId}:${reportType}`
  const { data: existing } = await db
    .from('moderation_reports')
    .select('id')
    .eq('post_id', postId)
    .eq('reporter_profile_id', profile.id)
    .eq('report_type', reportType)
    .maybeSingle()
  if (existing?.id) return { reportId: String(existing.id), created: false }
  const { data, error } = await db.from('moderation_reports').insert({
    post_id: postId,
    reporter_profile_id: profile.id,
    report_type: reportType,
    reason,
    status: 'open',
    updated_at: now,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create report')
  return { reportId: String((data as { id: string }).id), created: true, dedupeKey: existingKey }
}

export async function recordFeedback(postId: string, kind: 'not_interested' | 'hide_creator') {
  const db = createSupabaseAdmin()
  const profile = await requireProfile()
  const post = await loadTargetPost(db, postId)
  if (post.deleted_at || post.is_archived || post.status !== 'published') throw new Error('Post is not available')
  const eventKey = `feed-feedback:${profile.id}:${kind}:${postId}`
  const { error } = await db.from('feed_events').insert({
    event_key: eventKey,
    viewer_profile_id: profile.id,
    post_id: postId,
    event_type: kind,
    metadata: { kind },
  })
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
  if (kind === 'hide_creator') {
    await db.from('mutes').insert({ muter_profile_id: profile.id, muted_profile_id: post.author_profile_id, reason: 'hide_creator' }).then(() => {}, () => {})
  }
  return { postId, kind, removed: kind === 'hide_creator' }
}
