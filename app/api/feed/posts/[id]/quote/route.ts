import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { feedComposerActionInput } from '@/lib/feed/validators'
import { createQuote } from '@/lib/feed/interactions'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '@/lib/feed/shared'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_quotes_enabled'))) {
    return NextResponse.json({ error: 'Quotes are disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-quote:${session.userId ?? session.phone}`, 20, 60)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedComposerActionInput)
  if ('error' in parsed) return parsed.error

  try {
    const { id } = await params
    const result = await createQuote(id, parsed.data.body ?? '')
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create quote' }, { status: 400 })
  }
}
