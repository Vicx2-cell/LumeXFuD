import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { feedReplyInput } from '@/lib/feed/validators'
import { createReply } from '@/lib/feed/interactions'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '@/lib/feed/shared'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_replies_enabled'))) {
    return NextResponse.json({ error: 'Replies are disabled' }, { status: 503 })
  }

  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: rows, error } = await db
    .from('post_replies')
    .select('id, author_profile_id, body, like_count, reply_count, created_at')
    .eq('post_id', id)
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(80)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const authorIds = Array.from(new Set((rows ?? []).map((row) => String((row as { author_profile_id: string }).author_profile_id))))
  const { data: profiles } = authorIds.length > 0
    ? await db
        .from('social_profiles')
        .select('id, display_name, handle, avatar_url')
        .in('id', authorIds)
    : { data: [] }

  const profileById = new Map((profiles ?? []).map((profile) => {
    const typed = profile as { id: string; display_name: string | null; handle: string | null; avatar_url: string | null }
    return [typed.id, typed] as const
  }))

  return NextResponse.json({
    comments: (rows ?? []).map((row) => {
      const typed = row as { id: string; author_profile_id: string; body: string; like_count: number | null; reply_count: number | null; created_at: string }
      const profile = profileById.get(typed.author_profile_id)
      return {
        id: typed.id,
        profileId: typed.author_profile_id,
        body: typed.body,
        author: profile?.display_name ?? profile?.handle ?? 'Student',
        handle: profile?.handle ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        likeCount: typed.like_count ?? 0,
        replyCount: typed.reply_count ?? 0,
        createdAt: typed.created_at,
      }
    }),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_replies_enabled'))) {
    return NextResponse.json({ error: 'Replies are disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-reply:${session.userId ?? session.phone}`, 20, 60)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedReplyInput)
  if ('error' in parsed) return parsed.error

  try {
    const { id } = await params
    const result = await createReply(id, parsed.data.body, parsed.data.parent_reply_id)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create reply' }, { status: 400 })
  }
}
