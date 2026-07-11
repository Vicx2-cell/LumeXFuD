import { NextRequest, NextResponse } from 'next/server'
import { requireFeedSession, rateLimitFeed } from '@/lib/feed/shared'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { deleteVideo } from '@/lib/feed/lifecycle'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const rl = await rateLimitFeed(`feed-delete:${auth.session.userId ?? auth.session.phone}`, 20, 60)
  if ('error' in rl) return rl.error
  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: post } = await db.from('posts').select('id, author_profile_id, deleted_at').eq('id', id).maybeSingle()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', auth.session.userId ?? '').maybeSingle()
  if (!post || !profile || String((post as { author_profile_id: string }).author_profile_id) !== String((profile as { id: string }).id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  let body: { reason?: string } = {}
  try { body = await req.json() } catch {}
  try {
    await deleteVideo(id, body.reason)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete post' }, { status: 400 })
  }
}
