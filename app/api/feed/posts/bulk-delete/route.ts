import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFeedSession, parseJsonBody, rateLimitFeed } from '../../_shared'
import { bulkVideoAction } from '@/lib/feed/lifecycle'

const input = z.object({ post_ids: z.array(z.string().uuid()).min(1).max(50), reason: z.string().trim().max(500).optional(), confirm: z.boolean() })

export async function POST(req: NextRequest) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const rl = await rateLimitFeed(`feed-bulk-delete:${auth.session.userId ?? auth.session.phone}`, 10, 60)
  if ('error' in rl) return rl.error
  const parsed = await parseJsonBody(req, input)
  if ('error' in parsed) return parsed.error
  if (!parsed.data.confirm) return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })
  try {
    const results = await bulkVideoAction(parsed.data.post_ids, 'delete', parsed.data.reason)
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete posts' }, { status: 400 })
  }
}

