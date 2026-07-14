import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { ensureSocialProfileForSession } from '@/lib/feed/service'
import { canCreateStory, loadFeedPermissionContext, resolveFeedPublisherKind, storyStatusForPublisher } from '@/lib/feed/permissions'
import { feedStoryCreateInput } from '@/lib/feed/validators'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '../_shared'

export async function POST(req: NextRequest) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session

  if (!(await getFeature('feed_enabled'))) {
    return NextResponse.json({ error: 'Feed is disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-story:${session.userId ?? session.phone}`, 10, 300)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedStoryCreateInput)
  if ('error' in parsed) return parsed.error

  const db = createSupabaseAdmin()
  const profile = await ensureSocialProfileForSession()
  if (!profile?.id) return NextResponse.json({ error: 'Could not resolve profile' }, { status: 400 })

  const context = await loadFeedPermissionContext(db, profile.id)
  if (!canCreateStory(context.profile, context.vendor)) {
    return NextResponse.json({ error: 'This account cannot post stories' }, { status: 403 })
  }

  const publisherKind = resolveFeedPublisherKind(context.profile, context.vendor)
  if (publisherKind === 'student') {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const { count } = await db
      .from('feed_stories')
      .select('id', { count: 'exact', head: true })
      .eq('author_profile_id', profile.id)
      .gte('created_at', startOfDay.toISOString())
      .in('status', ['published', 'under_review'])
    if ((count ?? 0) >= 1) {
      return NextResponse.json({ error: 'Students can submit one story per day' }, { status: 429 })
    }
  }

  const status = storyStatusForPublisher(context.profile, context.vendor)
  const { data, error } = await db
    .from('feed_stories')
    .insert({
      author_profile_id: profile.id,
      post_id: parsed.data.post_id ?? null,
      media_url: parsed.data.media_url ?? null,
      media_kind: parsed.data.media_kind,
      caption: parsed.data.caption ?? null,
      status,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      approved_at: status === 'published' ? new Date().toISOString() : null,
      approved_by: status === 'published' ? `${session.role}:${session.userId ?? session.phone}` : null,
    })
    .select('id, status')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not create story' }, { status: 400 })
  }

  return NextResponse.json({ ok: true, storyId: data.id, status: data.status })
}
