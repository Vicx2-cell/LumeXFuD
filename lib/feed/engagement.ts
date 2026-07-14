import { createSupabaseAdmin } from '@/lib/supabase/server'
import { ensureSocialProfileForSession } from './service'

export interface FeedWatchInput {
  postId: string
  watchMs: number
  completionRate: number
  locationRelevanceScore: number
  orderConversions: number
  sourceTab?: string | null
  sessionId?: string | null
  metadata?: Record<string, unknown>
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function buildFeedWatchKey(profileId: string, postId: string, sessionId: string | null | undefined, sourceTab: string | null | undefined) {
  return [profileId, postId, sessionId ?? 'session', sourceTab ?? 'feed'].join(':')
}

export async function recordFeedWatch(input: FeedWatchInput) {
  const profile = await ensureSocialProfileForSession()
  if (!profile?.id) throw new Error('Could not resolve social profile')

  const db = createSupabaseAdmin()
  const watchKey = buildFeedWatchKey(profile.id, input.postId, input.sessionId, input.sourceTab)
  const payload = {
    p_watch_key: watchKey,
    p_post_id: input.postId,
    p_viewer_profile_id: profile.id,
    p_watch_ms: Math.max(0, Math.round(input.watchMs)),
    p_completion_rate: clamp(Number(input.completionRate) || 0, 0, 1),
    p_location_relevance_score: Math.max(0, Number(input.locationRelevanceScore) || 0),
    p_order_conversions: Math.max(0, Math.round(input.orderConversions)),
    p_source_tab: input.sourceTab ?? null,
    p_session_id: input.sessionId ?? null,
    p_metadata: input.metadata ?? {},
  }
  const { data, error } = await db.rpc('feed_record_watch_metrics', payload)
  if (error) throw new Error(error.message)
  return { ok: data === true, watchKey }
}
