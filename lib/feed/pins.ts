import 'server-only'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { canManageOfficialPins, type FeedPin } from './automation'

type DB = ReturnType<typeof createSupabaseAdmin>

async function syncPostPinnedFlag(db: DB, postId: string) {
  const { count } = await db.from('feed_post_pins').select('id', { count: 'exact', head: true })
    .eq('post_id', postId).is('unpinned_at', null)
  await db.from('posts').update({ is_pinned: (count ?? 0) > 0 }).eq('id', postId)
}

export async function pinOfficialPost(input: {
  role: string
  actorId: string
  postId: string
  scopeType: FeedPin['scopeType']
  scopeId: string | null
  startsAt?: string
  expiresAt?: string | null
  priority?: number
}, db: DB = createSupabaseAdmin()) {
  const { data: post } = await db.from('posts').select('id, author_profile_id, status, is_archived, deleted_at').eq('id', input.postId).maybeSingle()
  if (!post || post.status !== 'published' || post.is_archived || post.deleted_at) throw new Error('Only a live published post can be pinned')
  const { data: author } = await db.from('social_profiles').select('system_account_key, is_system_account, official_badge_kind').eq('id', post.author_profile_id).maybeSingle()
  const official = author?.system_account_key === 'lumex_fud' && author.is_system_account === true && author.official_badge_kind === 'official'
  if (!canManageOfficialPins(input.role, official)) throw new Error('Only a super admin can pin an official LumeX Fud post')
  if ((input.scopeType === 'global') !== (input.scopeId === null)) throw new Error('Global pins cannot have a scope id; scoped pins require one')
  const startsAt = input.startsAt ?? new Date().toISOString()
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= new Date(startsAt).getTime()) throw new Error('Pin expiry must be after its start')
  const now = new Date().toISOString()
  let active = db.from('feed_post_pins').select('id, post_id').eq('scope_type', input.scopeType).is('unpinned_at', null)
  active = input.scopeId ? active.eq('scope_id', input.scopeId) : active.is('scope_id', null)
  const { data: replaced } = await active
  for (const pin of replaced ?? []) {
    await db.from('feed_post_pins').update({ unpinned_at: now, unpinned_by: input.actorId }).eq('id', pin.id)
    await syncPostPinnedFlag(db, String(pin.post_id))
    await db.from('feed_generation_audit').insert({ post_id: pin.post_id, action: 'unpinned', reason: 'replaced by the primary pin for this scope', actor_type: 'super_admin', actor_id: input.actorId })
  }
  const { data: pin, error } = await db.from('feed_post_pins').insert({
    post_id: input.postId,
    scope_type: input.scopeType,
    scope_id: input.scopeId,
    priority: Math.max(0, Math.min(1_000, input.priority ?? 0)),
    starts_at: startsAt,
    expires_at: input.expiresAt ?? null,
    pinned_by: input.actorId,
  }).select('id').single()
  if (error || !pin) throw new Error(error?.message ?? 'Could not pin post')
  await db.from('posts').update({ is_pinned: true }).eq('id', input.postId)
  await db.from('feed_generation_audit').insert({ post_id: input.postId, action: 'pinned', reason: `official ${input.scopeType} pin`, actor_type: 'super_admin', actor_id: input.actorId, metadata: { scope_id: input.scopeId, expires_at: input.expiresAt ?? null } })
  return { pinId: String(pin.id), postId: input.postId }
}

export async function unpinOfficialPost(input: {
  role: string
  actorId: string
  pinId: string
}, db: DB = createSupabaseAdmin()) {
  if (input.role !== 'super_admin') throw new Error('Only a super admin can unpin official posts')
  const { data: pin } = await db.from('feed_post_pins').select('id, post_id').eq('id', input.pinId).is('unpinned_at', null).maybeSingle()
  if (!pin) throw new Error('Active pin not found')
  const now = new Date().toISOString()
  await db.from('feed_post_pins').update({ unpinned_at: now, unpinned_by: input.actorId }).eq('id', pin.id)
  await syncPostPinnedFlag(db, String(pin.post_id))
  await db.from('feed_generation_audit').insert({ post_id: pin.post_id, action: 'unpinned', reason: 'manual super-admin unpin', actor_type: 'super_admin', actor_id: input.actorId })
  return { pinId: input.pinId, postId: String(pin.post_id) }
}
