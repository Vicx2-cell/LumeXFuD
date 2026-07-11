import { NextRequest, NextResponse } from 'next/server'
import { requireFeedSession, parseJsonBody, rateLimitFeed } from '@/lib/feed/shared'
import { z } from 'zod'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { archiveVideo } from '@/lib/feed/lifecycle'

const input = z.object({ reason: z.string().trim().max(500).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeedSession()
  if ('error' in auth) return auth.error
  const rl = await rateLimitFeed(`feed-archive:${auth.session.userId ?? auth.session.phone}`, 20, 60)
  if ('error' in rl) return rl.error
  const parsed = await parseJsonBody(req, input)
  if ('error' in parsed) return parsed.error
  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: post } = await db.from('posts').select('id, author_profile_id, deleted_at').eq('id', id).maybeSingle()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', auth.session.userId ?? '').maybeSingle()
  if (!post || !profile || String((post as { author_profile_id: string }).author_profile_id) !== String((profile as { id: string }).id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    await archiveVideo(id, parsed.data.reason)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not archive post' }, { status: 400 })
  }
}
