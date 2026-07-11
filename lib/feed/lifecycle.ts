import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { getVideoQuotaForVendor, loadVideoManagementConfig, archiveVideoPostAtomic, deleteVideoPostAtomic, restoreVideoPostAtomic, type FeedVideoState, type VideoLifecycleItem, type VideoSuggestion } from './video-management'

async function requireVendorProfile() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor' || !session.userId) throw new Error('Vendor authentication required')
  const db = createSupabaseAdmin()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', session.userId).maybeSingle()
  if (!profile) throw new Error('Vendor profile not found')
  return { session, profileId: String((profile as { id: string }).id), db }
}

export async function loadVendorVideoLibrary(state: FeedVideoState = 'active', limit = 24) {
  const { profileId, db } = await requireVendorProfile()
  const quota = await getVideoQuotaForVendor(profileId)
  const cfg = await loadVideoManagementConfig()
  const query = db
    .from('posts')
    .select(`
      id, body, post_kind, status, is_archived, deleted_at, archived_at, published_at, created_at, updated_at,
      view_count, order_count, provider_connection_id, provider_video_id, related_menu_item_id, storage_bytes,
      post_media (
        id, media_kind, public_url, storage_path, provider_type, external_provider_ref, storage_bytes,
        cleanup_state, cleanup_attempts, created_at
      )
    `)
    .eq('author_profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (state === 'active') query.eq('status', 'published').eq('is_archived', false).is('deleted_at', null)
  if (state === 'drafts') query.eq('status', 'draft').is('deleted_at', null)
  if (state === 'archived') query.eq('is_archived', true).is('deleted_at', null)
  if (state === 'processing') query.eq('status', 'processing').is('deleted_at', null)
  if (state === 'failed') query.in('status', ['rejected', 'deleted'])

  const { data } = await query
  const items = (data ?? []) as unknown as Array<VideoLifecycleItem & { body: string | null }>
  const suggestions = await getVideoArchiveSuggestions(profileId, cfg.staleSuggestionThresholdDays)
  return {
    quota,
    items: items.map((item) => ({
      ...item,
      caption: item.body,
      post_media: Array.isArray(item.post_media) ? item.post_media : [],
    })),
    suggestions,
    config: cfg,
  }
}

export async function getVideoArchiveSuggestions(profileId: string, staleDays: number): Promise<VideoSuggestion[]> {
  const db = createSupabaseAdmin()
  const staleCutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString()
  const { data } = await db
    .from('posts')
    .select('id, body, view_count, order_count, published_at, archived_at, deleted_at, related_menu_item_id, post_promotions(status, ends_at), post_menu_items(is_available_snapshot)')
    .eq('author_profile_id', profileId)
    .eq('status', 'published')
    .eq('is_archived', false)
    .is('deleted_at', null)
    .lt('published_at', staleCutoff)
    .limit(50)

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const suggestions: VideoSuggestion[] = []
  for (const row of rows) {
    const viewCount = Number(row.view_count ?? 0)
    const orderCount = Number(row.order_count ?? 0)
    const reasons: string[] = []
    if (viewCount === 0) reasons.push(`No views in ${staleDays} days`)
    if (orderCount === 0) reasons.push('No attributed orders')
    const menuItems = Array.isArray(row.post_menu_items) ? row.post_menu_items as Array<{ is_available_snapshot?: boolean }> : []
    if (menuItems.some((m) => m.is_available_snapshot === false)) reasons.push('Attached menu item unavailable')
    const promos = Array.isArray(row.post_promotions) ? row.post_promotions as Array<{ status?: string | null; ends_at?: string | null }> : []
    if (promos.some((promo) => promo.status === 'expired' || (promo.ends_at && new Date(String(promo.ends_at)) < new Date()))) reasons.push('Expired promotion')
    if (reasons.length === 0) continue
    suggestions.push({
      postId: String(row.id),
      reason: reasons[0]!,
      evidence: { view_count: viewCount, order_count: orderCount, stale_cutoff: staleCutoff },
      expectedQuotaRecovered: 1,
    })
  }
  return suggestions
}

export async function archiveVideo(postId: string, reason?: string) {
  const { profileId } = await requireVendorProfile()
  return archiveVideoPostAtomic(postId, profileId, reason)
}

export async function restoreVideo(postId: string) {
  const { profileId } = await requireVendorProfile()
  return restoreVideoPostAtomic(postId, profileId)
}

export async function deleteVideo(postId: string, reason?: string) {
  const { profileId } = await requireVendorProfile()
  return deleteVideoPostAtomic(postId, profileId, reason)
}

export async function bulkVideoAction(postIds: string[], action: 'archive' | 'restore' | 'delete', reason?: string) {
  const cfg = await loadVideoManagementConfig()
  if (postIds.length > cfg.maxBulkActionSize) throw new Error(`Bulk actions are limited to ${cfg.maxBulkActionSize} posts`)
  const results: Array<{ postId: string; ok: boolean; error?: string }> = []
  for (const postId of postIds) {
    try {
      if (action === 'archive') await archiveVideo(postId, reason)
      else if (action === 'restore') await restoreVideo(postId)
      else await deleteVideo(postId, reason)
      results.push({ postId, ok: true })
    } catch (error) {
      results.push({ postId, ok: false, error: error instanceof Error ? error.message : 'Failed' })
    }
  }
  return results
}

export async function cleanupVideoMedia(dryRun = true) {
  const { profileId } = await requireVendorProfile().catch(() => ({ profileId: null }))
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('post_media')
    .select('id, post_id, storage_path, public_url, provider_type, external_provider_ref, cleanup_state, cleanup_attempts, storage_bytes, created_at, post:posts!inner(id, deleted_at, is_archived, status, author_profile_id, archived_at, published_at)')
    .eq('cleanup_state', 'pending')
  const candidates = (data ?? []).filter((row) => {
    const post = (row as { post?: { deleted_at?: string | null; is_archived?: boolean | null; status?: string | null; author_profile_id?: string | null } }).post
    return !!post && (!profileId || post.author_profile_id === profileId)
  })
  if (!dryRun && candidates.length > 0) {
    const candidateIds = new Set(candidates.map((candidate) => String((candidate as { id: string }).id)))
    const paths = candidates.map((candidate) => String((candidate as { storage_path?: string | null }).storage_path ?? '')).filter(Boolean)
    const uniquePaths = Array.from(new Set(paths))
    let safePaths = uniquePaths
    if (uniquePaths.length > 0) {
      const { data: refs } = await db
        .from('post_media')
        .select('id, storage_path, post:posts!inner(id, deleted_at, is_archived, status, author_profile_id)')
        .in('storage_path', uniquePaths)
      safePaths = uniquePaths.filter((path) => {
        const matches = (refs ?? []).filter((ref) => String((ref as { storage_path?: string | null }).storage_path ?? '') === path)
        return matches.length === 1 && candidateIds.has(String((matches[0] as { id: string }).id))
      })
    }
    const safeCandidates = candidates.filter((candidate) => safePaths.includes(String((candidate as { storage_path?: string | null }).storage_path ?? '')))
    if (safePaths.length > 0) {
      await db.storage.from('feed-media').remove(safePaths).catch(() => {})
    }
    await Promise.all(safeCandidates.map(async (candidate) => {
      const mediaId = String((candidate as { id: string }).id)
      await db.from('post_media').update({ cleanup_state: 'done', cleaned_at: new Date().toISOString(), cleanup_error: null }).eq('id', mediaId)
    }))
    return {
      dryRun,
      candidateCount: candidates.length,
      deletedCount: safeCandidates.length,
      candidates: candidates.slice(0, 50),
    }
  }
  return {
    dryRun,
    candidateCount: candidates.length,
    deletedCount: 0,
    candidates: candidates.slice(0, 50),
  }
}
