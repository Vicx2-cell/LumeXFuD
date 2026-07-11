import { NextRequest, NextResponse } from 'next/server'
import { requireFeedSession, parseJsonBody } from '../_shared'
import { feedEventBatchInput } from '@/lib/feed/validators'
import { recordFeedEventBatch } from '@/lib/feed/events'

export async function POST(req: NextRequest) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error

  const parsed = await parseJsonBody(req, feedEventBatchInput)
  if ('error' in parsed) return parsed.error

  try {
    const result = await recordFeedEventBatch(parsed.data, auth.session.sessionId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not record feed events'
    const status = /too many feed events/i.test(message) ? 429 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

