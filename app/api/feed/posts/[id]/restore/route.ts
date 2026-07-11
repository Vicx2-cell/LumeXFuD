import { NextRequest, NextResponse } from 'next/server'
import { requireFeedSession, rateLimitFeed } from '../../../_shared'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { restoreVideo } from '@/lib/feed/lifecycle'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const rl = await rateLimitFeed(`feed-restore:${auth.session.userId ?? auth.session.phone}`, 20, 60)
  if ('error' in rl) return rl.error
  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: post } = await db.from('posts').select('id, author_profile_id, deleted_at').eq('id', id).maybeSingle()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', auth.session.userId ?? '').maybeSingle()
  const { data: vendor } = await db.from('vendors').select('id, suspended_until').eq('id', auth.session.userId ?? '').maybeSingle()
  if (vendor && (vendor as { suspended_until?: string | null }).suspended_until && new Date(String((vendor as { suspended_until?: string | null }).suspended_until)).getTime() > Date.now()) {
    return NextResponse.json({ error: 'Suspended vendors cannot restore videos' }, { status: 403 })
  }
  if (!post || !profile || String((post as { author_profile_id: string }).author_profile_id) !== String((profile as { id: string }).id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const result = await restoreVideo(id)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not restore post' }, { status: 400 })
  }
}
