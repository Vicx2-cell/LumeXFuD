import { NextRequest, NextResponse } from 'next/server'
import { feedTabKeySchema } from '@/lib/feed/validators'
import { loadFeedV2Surface } from '@/lib/feed/v2'

export async function GET(req: NextRequest) {
  const tab = feedTabKeySchema.safeParse(req.nextUrl.searchParams.get('tab') ?? 'for_you')
  if (!tab.success) return NextResponse.json({ error: 'Invalid feed tab' }, { status: 400 })
  const offset = Number.parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10)
  if (!Number.isFinite(offset) || offset < 0 || offset > 10_000) {
    return NextResponse.json({ error: 'Invalid feed offset' }, { status: 400 })
  }
  try {
    const surface = await loadFeedV2Surface({ tab: tab.data, offset, limit: 12 })
    return NextResponse.json({ posts: surface.posts, hasMore: surface.hasMore, nextOffset: surface.nextOffset })
  } catch (error) {
    console.error('[feed/page] load failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load more posts' }, { status: 503 })
  }
}
