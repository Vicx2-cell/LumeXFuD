import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { feedComposerActionInput } from '@/lib/feed/validators'
import { createOrSaveFeedPost } from '@/lib/feed/posts'

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_posting_enabled'))) {
    return NextResponse.json({ error: 'Feed posting is disabled' }, { status: 503 })
  }

  const rl = await rateLimitGeneric(`feed-draft:${session.userId ?? session.phone}`, 20, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let parsed
  try {
    parsed = feedComposerActionInput.parse(await req.json())
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await createOrSaveFeedPost(session, parsed, 'draft')
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save draft' }, { status: 400 })
  }
}

