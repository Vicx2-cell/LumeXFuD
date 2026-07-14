import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { recordFeedWatch } from '@/lib/feed/engagement'
import { requireFeedSession, parseJsonBody } from '@/lib/feed/shared'

const watchSchema = z.object({
  post_id: z.string().uuid(),
  watch_ms: z.number().int().min(0).max(3_600_000),
  completion_rate: z.number().min(0).max(1).default(0),
  location_relevance_score: z.number().min(0).max(10).default(0),
  order_conversions: z.number().int().min(0).max(100).default(0),
  source_tab: z.enum(['for_you', 'following', 'nearby', 'deals', 'trending']).optional(),
  session_id: z.string().trim().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export async function POST(req: NextRequest) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  if (!(await getFeature('feed_enabled'))) {
    return NextResponse.json({ error: 'Feed is disabled' }, { status: 503 })
  }

  const rl = await rateLimitGeneric(`feed-watch:${auth.session.userId ?? auth.session.phone}`, 90, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const parsed = await parseJsonBody(req, watchSchema)
  if ('error' in parsed) return parsed.error

  try {
    const result = await recordFeedWatch({
      postId: parsed.data.post_id,
      watchMs: parsed.data.watch_ms,
      completionRate: parsed.data.completion_rate,
      locationRelevanceScore: parsed.data.location_relevance_score,
      orderConversions: parsed.data.order_conversions,
      sourceTab: parsed.data.source_tab ?? null,
      sessionId: parsed.data.session_id ?? null,
      metadata: parsed.data.metadata,
    })
    return NextResponse.json({ ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not record watch metrics' }, { status: 400 })
  }
}
