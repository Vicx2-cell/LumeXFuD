import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { feedFeedbackInput } from '@/lib/feed/validators'
import { recordFeedback } from '@/lib/feed/interactions'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '@/lib/feed/shared'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session
  if (!(await getFeature('feed_enabled'))) {
    return NextResponse.json({ error: 'Feed is disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-feedback:${session.userId ?? session.phone}`, 30, 60)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedFeedbackInput)
  if ('error' in parsed) return parsed.error

  try {
    const { id } = await params
    const result = await recordFeedback(id, parsed.data.kind)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update feedback' }, { status: 400 })
  }
}
