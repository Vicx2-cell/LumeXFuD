import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { feedReportInput } from '@/lib/feed/validators'
import { createReport } from '@/lib/feed/interactions'
import { parseJsonBody, rateLimitFeed, requireFeedSession } from '@/lib/feed/shared'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const session = auth.session
  if (!(await getFeature('feed_enabled'))) {
    return NextResponse.json({ error: 'Feed is disabled' }, { status: 503 })
  }

  const rl = await rateLimitFeed(`feed-report:${session.userId ?? session.phone}`, 10, 60, true)
  if ('error' in rl) return rl.error

  const parsed = await parseJsonBody(req, feedReportInput)
  if ('error' in parsed) return parsed.error

  try {
    const { id } = await params
    const result = await createReport(id, parsed.data.report_type, parsed.data.reason)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not report post' }, { status: 400 })
  }
}
