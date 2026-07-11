import { NextRequest, NextResponse } from 'next/server'
import { requireFeedSession, rateLimitFeed } from '../../../_shared'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const rl = await rateLimitFeed(`feed-retry-processing:${auth.session.userId ?? auth.session.phone}`, 20, 60)
  if ('error' in rl) return rl.error

  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: post } = await db.from('posts').select('id, author_profile_id, deleted_at, status').eq('id', id).maybeSingle()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', auth.session.userId ?? '').maybeSingle()
  if (!post || !profile || String((post as { author_profile_id: string }).author_profile_id) !== String((profile as { id: string }).id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if ((post as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ error: 'Deleted posts cannot be retried' }, { status: 409 })
  }
  try {
    await db.from('posts').update({
      status: 'processing',
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    await db.from('post_media').update({
      processing_state: 'pending',
      cleanup_state: 'none',
      cleanup_error: null,
    }).eq('post_id', id)
    return NextResponse.json({ ok: true, status: 'processing' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not retry processing' }, { status: 400 })
  }
}
