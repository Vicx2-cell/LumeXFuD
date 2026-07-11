import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { feedToggleInput } from '@/lib/feed/validators'
import { toggleFollow } from '@/lib/feed/interactions'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '../../../_shared'

export async function POST(req: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_follows_enabled'))) {
    return NextResponse.json({ error: 'Follows are disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-follow:${session.userId ?? session.phone}`, 30, 60)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedToggleInput)
  if ('error' in parsed) return parsed.error

  try {
    const { profileId } = await params
    const result = await toggleFollow(profileId, parsed.data.enabled)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update follow' }, { status: 400 })
  }
}
