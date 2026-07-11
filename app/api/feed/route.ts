import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { getFeature } from '@/lib/features'
import { loadFeedSnapshot } from '@/lib/feed/service'

// GET /api/feed?tab=for_you
// First feed surface: returns a ranked snapshot plus tab availability so the UI
// can render a real commerce-first shell even before the composer and actions
// land.
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await getFeature('feed_enabled'))) {
    return NextResponse.json({ error: 'Feed is disabled' }, { status: 503 })
  }

  const url = new URL(req.url)
  const tab = url.searchParams.get('tab') ?? 'for_you'
  const cursor = url.searchParams.get('cursor') ?? undefined
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10)
  const snapshot = await loadFeedSnapshot(tab, cursor, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20)
  return NextResponse.json({
    tab: snapshot.tab,
    version: snapshot.version,
    tabs: snapshot.tabs,
    items: snapshot.items,
    nextCursor: snapshot.nextCursor,
    hasMore: snapshot.hasMore,
  })
}
