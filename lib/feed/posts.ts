import { createSupabaseAdmin } from '@/lib/supabase/server'
import { sanitize } from '@/lib/security'
import { getFeature } from '@/lib/features'
import { ensureSocialProfileForSession } from './service'
import { ensureOfficialAccount } from './official-service'
import { canPublishFeedPost, loadFeedPermissionContext } from './permissions'
import { publishVideoPostAtomic } from './video-management'
import type { SessionPayload } from '@/lib/session'
import type { FeedComposerActionInput } from './validators'
import { normalizeFeedAuthorMode } from './authoring'

type FeedComposerBody = FeedComposerActionInput

function cleanTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50)
}

async function ensureProfile() {
  const profile = await ensureSocialProfileForSession()
  if (!profile) throw new Error('Could not create social profile')
  return profile
}

async function ensureAuthorProfile(session: SessionPayload, publishAs?: FeedComposerBody['publish_as']) {
  const authorMode = normalizeFeedAuthorMode(session.role, publishAs)
  if (authorMode === 'lumex') {
    return await ensureOfficialAccount()
  }
  return await ensureProfile()
}

async function loadOwnedMenuSnapshots(db: ReturnType<typeof createSupabaseAdmin>, vendorId: string, menuItemIds: string[]) {
  if (menuItemIds.length === 0) return []
  const { data } = await db
    .from('menu_items')
    .select('id, name, price_kobo, image_url, is_available, deleted_at')
    .in('id', menuItemIds)
    .eq('vendor_id', vendorId)
  const rows = (data ?? []) as Array<{ id: string; name: string; price_kobo: number; image_url: string | null; is_available: boolean; deleted_at: string | null }>
  if (rows.length !== menuItemIds.length) throw new Error('One or more menu items could not be found')
  return rows
}

async function replacePostChildren(db: ReturnType<typeof createSupabaseAdmin>, postId: string) {
  await db.from('post_media').delete().eq('post_id', postId)
  await db.from('post_menu_items').delete().eq('post_id', postId)
  await db.from('post_hashtags').delete().eq('post_id', postId)
  await db.from('mentions').delete().eq('post_id', postId)
}

function inferPostKind(body: FeedComposerBody): FeedComposerBody['post_kind'] {
  if (body.post_kind !== 'TEXT') return body.post_kind
  if (body.promotion) return 'PROMOTION'
  if (body.menu_items.length > 0) return 'MENU_ITEM'
  if (body.media.some((m) => m.kind === 'video')) return 'VIDEO'
  if (body.media.some((m) => m.kind === 'image')) return 'IMAGE'
  if (body.quoted_post_id) return 'QUOTE'
  return 'TEXT'
}

export async function createOrSaveFeedPost(
  session: SessionPayload,
  body: FeedComposerBody,
  mode: 'draft' | 'publish',
) {
  const db = createSupabaseAdmin()
  const profile = await ensureAuthorProfile(session, body.publish_as)
  const permissionContext = await loadFeedPermissionContext(db, profile.id)
  const profileCampusId = 'campus_id' in profile ? profile.campus_id ?? null : null
  const profileZoneId = 'zone_id' in profile ? profile.zone_id ?? null : null
  const postKind = inferPostKind(body)

  if (!(await getFeature('feed_posting_enabled'))) throw new Error('Posting is disabled')
  if (postKind === 'VIDEO' && !(await getFeature('feed_native_video_enabled'))) throw new Error('Video posts are disabled')
  if (postKind === 'PROMOTION' && !(await getFeature('feed_promotion_posts_enabled'))) throw new Error('Promotions are disabled')
  if (postKind === 'MENU_ITEM' && !(await getFeature('feed_menu_posts_enabled'))) throw new Error('Menu-item posts are disabled')
  if (postKind === 'TIKTOK' && !(await getFeature('feed_tiktok_enabled'))) throw new Error('TikTok posts are disabled')

  const isVendor = session.role === 'vendor'
  const isOfficialAuthor = body.publish_as === 'lumex'
  if (isOfficialAuthor && !(session.role === 'admin' || session.role === 'super_admin')) {
    throw new Error('Only super-admin or admin can post as LumeX Fud')
  }
  if (!canPublishFeedPost(permissionContext.profile, permissionContext.vendor)) {
    throw new Error('This account cannot publish feed posts')
  }
  if (isOfficialAuthor && (body.menu_items.length > 0 || body.promotion)) {
    throw new Error('Official posts cannot attach commerce items')
  }
  if (body.menu_items.length > 0 && !isVendor) throw new Error('Only vendors can attach menu items')
  if (body.promotion && !isVendor) throw new Error('Only vendors can attach promotions')
  if (body.provider_video_id && postKind !== 'TIKTOK') throw new Error('Provider videos require a TikTok post')

  const videoCount = body.media.filter((m) => m.kind === 'video').length + (postKind === 'TIKTOK' ? 1 : 0)
  const requireAtomicPublish = mode === 'publish' && videoCount > 0

  const cleanBody = body.body ? sanitize(body.body) : null
  const hashtags = Array.from(new Set([
    ...body.hashtags.map(cleanTag).filter(Boolean),
    ...(cleanBody ? cleanBody.split(/\s+/).filter((t) => t.startsWith('#')).map(cleanTag).filter(Boolean) : []),
  ])).slice(0, 20)

  const mentionHandles = Array.from(new Set(body.mentions.map((m) => m.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))).slice(0, 20)

  let draftId = body.draft_id ?? null
  if (!draftId) {
    const { data } = await db.from('posts').insert({
      author_profile_id: profile.id,
      vendor_id: session.role === 'vendor' ? session.userId : null,
      post_kind: postKind,
      status: requireAtomicPublish ? 'draft' : (mode === 'draft' ? 'draft' : 'published'),
      visibility: body.visibility,
      audience_scope: body.audience_scope,
      body: cleanBody,
      content_warning: body.content_warning ?? null,
      campus_id: body.campus_id ?? profileCampusId,
      zone_id: body.zone_id ?? profileZoneId,
      location_text: body.location_text ?? null,
      hashtags_cached: hashtags,
      scheduled_for: body.scheduled_for ?? null,
      is_pinned: body.is_pinned ?? false,
      published_at: requireAtomicPublish ? null : (mode === 'publish' ? new Date().toISOString() : null),
      updated_at: new Date().toISOString(),
    }).select('id').single()
    draftId = data?.id ?? null
    if (!draftId) throw new Error('Could not create post')
  } else {
    const { data: existingPost } = await db
      .from('posts')
      .select('id, author_profile_id')
      .eq('id', draftId)
      .maybeSingle()
    if (!existingPost) throw new Error('Draft not found')
    if (String((existingPost as { author_profile_id: string }).author_profile_id) !== profile.id) {
      throw new Error('This draft belongs to a different author')
    }
    await db.from('posts').update({
      post_kind: postKind,
      status: requireAtomicPublish ? 'draft' : (mode === 'draft' ? 'draft' : 'published'),
      visibility: body.visibility,
      audience_scope: body.audience_scope,
      body: cleanBody,
      content_warning: body.content_warning ?? null,
      campus_id: body.campus_id ?? profileCampusId,
      zone_id: body.zone_id ?? profileZoneId,
      location_text: body.location_text ?? null,
      hashtags_cached: hashtags,
      scheduled_for: body.scheduled_for ?? null,
      is_pinned: body.is_pinned ?? false,
      published_at: requireAtomicPublish ? null : (mode === 'publish' ? new Date().toISOString() : null),
      is_archived: false,
      archived_at: null,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', draftId).eq('author_profile_id', profile.id)
    await replacePostChildren(db, draftId)
  }

  if (!draftId) throw new Error('Could not resolve post id')

  const postTasks: Promise<unknown>[] = []

  if (body.media.length > 0) {
    postTasks.push((async () => {
      const { error } = await db.from('post_media').insert(
        body.media.map((media, index) => ({
          post_id: draftId,
          media_kind: media.kind,
          storage_path: media.storage_path ?? null,
          public_url: media.public_url ?? null,
          provider_name: media.provider_name ?? null,
          provider_url: media.provider_url ?? null,
          mime_type: media.mime_type ?? null,
          width: media.width ?? null,
          height: media.height ?? null,
          duration_seconds: media.duration_seconds ?? null,
          alt_text: media.alt_text ?? null,
          caption: media.caption ?? null,
          sort_order: media.sort_order ?? index,
          is_primary: media.is_primary ?? index === 0,
        }))
      )
      if (error) throw new Error(`Could not attach uploaded media: ${error.message}`)
    })())
  }

  if (body.menu_items.length > 0) {
    postTasks.push((async () => {
      const snapshots = await loadOwnedMenuSnapshots(db, session.userId!, body.menu_items.map((m) => m.menu_item_id))
      const byId = new Map(snapshots.map((row) => [row.id, row]))
      await db.from('post_menu_items').insert(
        body.menu_items.map((item, index) => {
          const snapshot = byId.get(item.menu_item_id)
          if (!snapshot) throw new Error('Menu item not found')
          return {
            post_id: draftId,
            menu_item_id: item.menu_item_id,
            menu_item_name_snapshot: snapshot.name,
            menu_item_price_kobo_snapshot: snapshot.price_kobo,
            menu_item_image_url_snapshot: snapshot.image_url ?? null,
            is_primary: item.is_primary ?? index === 0,
            order_label: item.order_label ?? null,
            is_available_snapshot: snapshot.is_available,
          }
        })
      )
    })())
  }

  if (body.promotion) {
    postTasks.push((async () => {
      const promo = body.promotion
      if (!promo) throw new Error('Promotion payload missing')
      if (!Number.isInteger(promo.campaign_price_kobo) || promo.campaign_price_kobo <= 0 || promo.campaign_price_kobo > 100_000_000) {
        throw new Error('Invalid promotion price')
      }
      const { data: promotion } = await db.from('post_promotions').insert({
        post_id: draftId,
        vendor_id: session.userId!,
        title: promo.title,
        description: promo.description ?? null,
        campaign_price_kobo: promo.campaign_price_kobo,
        landing_url: promo.landing_url ?? null,
        starts_at: promo.starts_at ?? null,
        ends_at: promo.ends_at ?? null,
        status: mode === 'publish' ? 'active' : 'draft',
        updated_at: new Date().toISOString(),
      }).select('id').single()
      if (promotion?.id) {
        await db.from('posts').update({ related_promotion_ref: promotion.id }).eq('id', draftId)
      }
    })())
  }

  if (hashtags.length > 0) {
    postTasks.push((async () => {
      for (const tag of hashtags) {
        const { data: existing } = await db.from('hashtags').select('id').eq('tag', tag).maybeSingle()
        let hashtagId = existing?.id as string | undefined
        if (!hashtagId) {
          const { data: created } = await db.from('hashtags').insert({ tag }).select('id').single()
          hashtagId = created?.id
        }
        if (hashtagId) {
          await db.from('post_hashtags').insert({ post_id: draftId, hashtag_id: hashtagId })
        }
      }
    })())
  }

  if (mentionHandles.length > 0) {
    postTasks.push((async () => {
      const { data: profiles } = await db
        .from('social_profiles')
        .select('id, handle')
        .in('handle', mentionHandles)
      const byHandle = new Map((profiles ?? []).map((p) => [String((p as { handle: string }).handle).toLowerCase(), p as { id: string; handle: string }]))
      await db.from('mentions').insert(
        mentionHandles.flatMap((handle) => {
          const p = byHandle.get(handle)
          return p ? [{ post_id: draftId, mentioned_profile_id: p.id }] : []
        })
      )
    })())
  }

  if (postTasks.length > 0) {
    await Promise.all(postTasks)
  }

  if (requireAtomicPublish) {
    const published = await publishVideoPostAtomic(draftId, profile.id)
    if (!published.ok) throw new Error(published.message)
  }

  return { postId: draftId, status: mode === 'draft' ? 'draft' : 'published', postKind, authorProfileId: profile.id }
}
