import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { canModerateStories } from '@/lib/feed/permissions'
import { feedStoryModerationInput } from '@/lib/feed/validators'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canModerateStories(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('feed_stories')
    .select('id, author_profile_id, media_url, media_kind, caption, status, starts_at, expires_at, created_at')
    .eq('status', 'under_review')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = data ?? []
  const authorIds = Array.from(new Set(rows.map((row) => String((row as { author_profile_id: string }).author_profile_id))))
  const { data: profiles } = authorIds.length > 0
    ? await db
        .from('social_profiles')
        .select('id, handle, display_name, avatar_url, profile_kind, is_verified, premium_verified, premium_label')
        .in('id', authorIds)
    : { data: [] }
  const profilesById = new Map((profiles ?? []).map((profile) => [String((profile as { id: string }).id), profile]))

  return NextResponse.json({
    stories: rows.map((row) => ({
      ...row,
      profile: profilesById.get(String((row as { author_profile_id: string }).author_profile_id)) ?? null,
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canModerateStories(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = feedStoryModerationInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  const { error } = await db
    .from('feed_stories')
    .update({
      status: parsed.data.action === 'approve' ? 'published' : 'rejected',
      approved_at: parsed.data.action === 'approve' ? now : null,
      approved_by: `${session.role}:${session.userId ?? session.phone}`,
      archived_at: parsed.data.action === 'reject' ? now : null,
      updated_at: now,
    })
    .eq('id', parsed.data.storyId)
    .eq('status', 'under_review')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
