import { NextResponse } from 'next/server'
import { requireFeedSession, rateLimitFeed } from '../_shared'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getVideoArchiveSuggestions } from '@/lib/feed/lifecycle'
import { loadVideoManagementConfig } from '@/lib/feed/video-management'

export async function GET() {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const rl = await rateLimitFeed(`feed-stale:${auth.session.userId ?? auth.session.phone}`, 20, 60)
  if ('error' in rl) return rl.error
  try {
    const db = createSupabaseAdmin()
    const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', auth.session.userId ?? '').maybeSingle()
    if (!profile) return NextResponse.json({ error: 'Vendor profile not found' }, { status: 404 })
    const cfg = await loadVideoManagementConfig()
    const suggestions = await getVideoArchiveSuggestions(String((profile as { id: string }).id), cfg.staleSuggestionThresholdDays)
    return NextResponse.json({ ok: true, suggestions })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load suggestions' }, { status: 400 })
  }
}
