import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error

  const db = createSupabaseAdmin()
  const { data: reportRows, error } = await db
    .from('moderation_reports')
    .select('id, post_id, reporter_profile_id, report_type, reason, status, resolution, assigned_to, resolved_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(80)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = reportRows ?? []
  const postIds = Array.from(new Set(rows.map((row) => String((row as { post_id: string }).post_id))))
  const profileIds = Array.from(new Set(rows.flatMap((row) => [
    String((row as { reporter_profile_id: string }).reporter_profile_id),
  ])))

  const [postResult, profileResult] = await Promise.all([
    postIds.length > 0
      ? db
          .from('posts')
          .select('id, author_profile_id, body, status, is_archived, deleted_at, view_count, like_count, reply_count, repost_count, bookmark_count, share_count, published_at, created_at, post_media(id, public_url, media_kind, sort_order, is_primary, alt_text), social_profiles!posts_author_profile_id_fkey(id, display_name, handle, avatar_url)')
          .in('id', postIds)
      : Promise.resolve({ data: [] }),
    profileIds.length > 0
      ? db
          .from('social_profiles')
          .select('id, display_name, handle, avatar_url')
          .in('id', profileIds)
      : Promise.resolve({ data: [] }),
  ])

  const postById = new Map((postResult.data ?? []).map((row) => {
    const typed = row as Record<string, unknown> & {
      id: string
      body: string | null
      status: string | null
      is_archived: boolean | null
      deleted_at: string | null
      view_count: number | null
      like_count: number | null
      reply_count: number | null
      repost_count: number | null
      bookmark_count: number | null
      share_count: number | null
      social_profiles?: Array<{ display_name: string | null; handle: string | null; avatar_url: string | null }>
      post_media?: Array<{ public_url: string | null; media_kind: string | null; sort_order: number | null; is_primary: boolean | null; alt_text: string | null }>
    }
    return [typed.id, typed] as const
  }))
  const reporterById = new Map((profileResult.data ?? []).map((row) => {
    const typed = row as { id: string; display_name: string | null; handle: string | null; avatar_url: string | null }
    return [typed.id, typed] as const
  }))

  const reports = rows.map((row) => {
    const typed = row as {
      id: string
      post_id: string
      reporter_profile_id: string
      report_type: string
      reason: string
      status: string
      resolution: string | null
      assigned_to: string | null
      resolved_at: string | null
      created_at: string
      updated_at: string
    }
    const post = postById.get(typed.post_id)
    const media = Array.isArray(post?.post_media) ? post?.post_media as Array<{ public_url: string | null; media_kind: string | null; is_primary: boolean | null; sort_order: number | null; alt_text: string | null }> : []
    const primaryMedia = media
      .slice()
      .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .find((item) => Boolean(item.public_url))
    return {
      ...typed,
      reporter: reporterById.get(typed.reporter_profile_id) ?? null,
      post: post ? {
        id: post.id,
        body: post.body,
        status: post.status,
        isArchived: post.is_archived,
        deletedAt: post.deleted_at,
        author: post.social_profiles?.[0] ?? null,
        viewCount: post.view_count ?? 0,
        likeCount: post.like_count ?? 0,
        replyCount: post.reply_count ?? 0,
        repostCount: post.repost_count ?? 0,
        saveCount: post.bookmark_count ?? 0,
        shareCount: post.share_count ?? 0,
        image: primaryMedia?.public_url ?? null,
        mediaKind: primaryMedia?.media_kind ?? null,
      } : null,
    }
  })

  return NextResponse.json({ reports })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error

  let body: { reportId?: string; action?: 'archive' | 'dismiss'; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.reportId || !body.action) {
    return NextResponse.json({ error: 'Missing report action' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  const { data: report } = await db
    .from('moderation_reports')
    .select('id, post_id, status')
    .eq('id', body.reportId)
    .maybeSingle()

  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  if (body.action === 'archive') {
    const { error } = await db
      .from('posts')
      .update({ status: 'deleted', deleted_at: now, archived_at: now, is_archived: true, updated_at: now })
      .eq('id', String((report as { post_id: string }).post_id))
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const { error } = await db
    .from('moderation_reports')
    .update({
      status: body.action === 'archive' ? 'resolved' : 'dismissed',
      resolution: body.action === 'archive' ? 'Removed by super-admin' : 'Dismissed by super-admin',
      resolved_at: now,
      updated_at: now,
    })
    .eq('id', body.reportId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await db.from('moderation_actions').insert({
    report_id: body.reportId,
    post_id: String((report as { post_id: string }).post_id),
    action_type: body.action === 'archive' ? 'remove' : 'warn',
    reason: body.reason ?? (body.action === 'archive' ? 'Bad post removed by super-admin' : 'Report dismissed by super-admin'),
    actor_role: 'super_admin',
    actor_reference: `${gate.session.role}:${gate.session.userId ?? gate.session.phone}`,
    previous_status: String((report as { status: string }).status),
    new_status: body.action === 'archive' ? 'resolved' : 'dismissed',
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true })
}
