import { NextRequest, NextResponse } from 'next/server'
import { requireFeedSession, rateLimitFeed } from '@/lib/feed/shared'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { deleteVideo } from '@/lib/feed/lifecycle'
import { canEditFeedPost } from '@/lib/feed/authoring'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  if (auth.session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', auth.session.userId ?? '').maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: post } = await db
    .from('posts')
    .select(`
      id, author_profile_id, body, post_kind, status, visibility, content_warning, location_text,
      hashtags_cached, published_at, is_archived, deleted_at,
      post_media(id, media_kind, storage_path, public_url, mime_type, duration_seconds, width, height, alt_text, caption, sort_order, is_primary),
      post_menu_items(menu_item_id, is_primary, order_label)
    `)
    .eq('id', id)
    .eq('author_profile_id', String((profile as { id: string }).id))
    .maybeSingle()

  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canEditFeedPost(post as { status: string; published_at: string | null; is_archived: boolean | null; deleted_at: string | null })) {
    return NextResponse.json({ error: 'Published posts can only be edited for 24 hours' }, { status: 409 })
  }
  if (((post as { post_media?: Array<{ id: string }> }).post_media ?? []).length > 1) {
    return NextResponse.json({ error: 'Posts with multiple media cannot be edited in this composer' }, { status: 409 })
  }
  return NextResponse.json({ post })
}

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
