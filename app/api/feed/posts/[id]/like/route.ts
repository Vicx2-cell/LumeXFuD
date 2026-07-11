import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { feedToggleInput } from '@/lib/feed/validators'
import { toggleLike } from '@/lib/feed/interactions'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '@/lib/feed/shared'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_likes_enabled'))) {
    return NextResponse.json({ error: 'Likes are disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-like:${session.userId ?? session.phone}`, 60, 60)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedToggleInput)
  if ('error' in parsed) return parsed.error

  try {
    const { id } = await params
    const result = await toggleLike(id, parsed.data.enabled)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update like' }, { status: 400 })
  }
}
