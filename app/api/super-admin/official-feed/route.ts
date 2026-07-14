import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { archiveOfficialPost, ensureOfficialAccount, listOfficialFeedPosts, upsertOfficialAreaSetting } from '@/lib/feed/official-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const areaSchema = z.object({
  areaScope: z.enum(['city', 'zone']),
  areaId: z.string().uuid().optional(),
  cityId: z.string().uuid().nullable().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  areaLabel: z.string().trim().min(1).max(120),
  morningEnabled: z.boolean().optional(),
  eveningEnabled: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  morningCron: z.string().trim().max(120).optional(),
  eveningCron: z.string().trim().max(120).optional(),
  lateNightStart: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  minPopularityOrders: z.number().int().min(0).optional(),
  priceThresholdKobo: z.number().int().min(0).optional(),
  maxPostsPerDay: z.number().int().min(1).max(20).optional(),
  maxCollectionItems: z.number().int().min(1).max(5).optional(),
  picksMaxPerDay: z.number().int().min(1).max(10).optional(),
})

const actionSchema = z.object({
  action: z.enum(['publish', 'archive', 'reject', 'edit', 'create']),
  postId: z.string().uuid().optional(),
  title: z.string().trim().max(120).optional(),
  subtitle: z.string().trim().max(240).optional(),
  generationReason: z.string().trim().max(500).optional(),
  briefTitle: z.string().trim().max(120).optional(),
  briefHook: z.string().trim().max(240).optional(),
  briefBullets: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
  briefCta: z.string().trim().max(120).optional(),
  briefAudience: z.string().trim().max(120).optional(),
  briefTone: z.string().trim().max(60).optional(),
  publish: z.boolean().optional(),
})

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
  const [posts, settings] = await Promise.all([
    listOfficialFeedPosts(db, 40),
    db.from('official_feed_area_settings').select('id, city_id, zone_id, area_scope, area_label, morning_enabled, evening_enabled, auto_publish, morning_cron, evening_cron, late_night_start, min_popularity_orders, price_threshold_kobo, max_posts_per_day, max_collection_items, picks_max_per_day, updated_by, updated_at').order('area_label', { ascending: true }),
  ])
  return NextResponse.json({ posts, settings: settings.data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error
  const rl = await rateLimitGeneric(`official-feed-settings:${gate.session.userId ?? gate.session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsed = areaSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid area settings' }, { status: 400 })
  const db = createSupabaseAdmin()
  const saved = await upsertOfficialAreaSetting(db, {
    cityId: parsed.data.cityId ?? null,
    zoneId: parsed.data.zoneId ?? null,
    areaScope: parsed.data.areaScope,
    areaLabel: parsed.data.areaLabel,
    morningEnabled: parsed.data.morningEnabled,
    eveningEnabled: parsed.data.eveningEnabled,
    autoPublish: parsed.data.autoPublish,
    morningCron: parsed.data.morningCron,
    eveningCron: parsed.data.eveningCron,
    lateNightStart: parsed.data.lateNightStart,
    minPopularityOrders: parsed.data.minPopularityOrders,
    priceThresholdKobo: parsed.data.priceThresholdKobo,
    maxPostsPerDay: parsed.data.maxPostsPerDay,
    maxCollectionItems: parsed.data.maxCollectionItems,
    picksMaxPerDay: parsed.data.picksMaxPerDay,
    updatedBy: gate.session.phone,
  })
  return NextResponse.json({ ok: true, setting: saved })
}

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error
  const rl = await rateLimitGeneric(`official-feed-action:${gate.session.userId ?? gate.session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  if (parsed.data.action !== 'create' && !parsed.data.postId) {
    return NextResponse.json({ error: 'Missing post id' }, { status: 400 })
  }
  const postId = parsed.data.postId as string

  const db = createSupabaseAdmin()
  if (parsed.data.action === 'create') {
    const account = await ensureOfficialAccount(db)
    const now = new Date().toISOString()
    const title = parsed.data.briefTitle ?? 'Official update'
    const hook = parsed.data.briefHook ?? 'Fresh campus picks, curated for today.'
    const bullets = (parsed.data.briefBullets ?? []).slice(0, 5)
    const cta = parsed.data.briefCta ?? 'Open the feed to see more.'
    const audience = parsed.data.briefAudience ?? 'Campus community'
    const tone = parsed.data.briefTone ?? 'calm'
    const body = [
      title,
      '',
      hook,
      ...bullets.map((bullet) => `- ${bullet}`),
      '',
      cta,
    ].join('\n')
    const publish = Boolean(parsed.data.publish)

    const { data: post, error: postError } = await db.from('posts').insert({
      author_profile_id: account.id,
      vendor_id: null,
      post_kind: 'TEXT',
      status: publish ? 'published' : 'draft',
      visibility: 'public',
      audience_scope: 'all',
      body,
      content_warning: null,
      campus_id: null,
      zone_id: null,
      location_text: audience,
      hashtags_cached: [],
      published_at: publish ? now : null,
      is_sponsored: false,
      is_boosted: false,
      is_archived: false,
      is_pinned: false,
      updated_at: now,
    }).select('id').single()

    if (postError || !post) {
      return NextResponse.json({ error: postError?.message ?? 'Could not create brief post.' }, { status: 500 })
    }

    const postId = String((post as { id: string }).id)
    const { error: metaError } = await db.from('official_feed_posts').insert({
      post_id: postId,
      area_setting_id: null,
      area_scope: 'city',
      area_id: 'brief',
      collection_type: 'editorial',
      source_type: 'manual_brief',
      source_id: `${account.id}:${now}`,
      generation_reason: `Manual brief created in CMS (${tone})`,
      selection_metadata: {
        title,
        hook,
        bullets,
        cta,
        audience,
        tone,
      },
      dedupe_key: `brief:${account.id}:${now}`,
      content_hash: `brief:${title}:${hook}:${bullets.join('|')}:${cta}`,
      is_auto_published: publish,
      approved_by: publish ? gate.session.phone : null,
      approved_at: publish ? now : null,
      updated_at: now,
    })

    if (metaError) {
      return NextResponse.json({ error: metaError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, postId })
  }

  if (parsed.data.action === 'edit') {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.subtitle) updates.body = parsed.data.subtitle
    if (parsed.data.generationReason || parsed.data.title) {
      const patch: Record<string, unknown> = {}
      if (parsed.data.generationReason) patch.generation_reason = parsed.data.generationReason
      if (parsed.data.title) patch.selection_metadata = { title: parsed.data.title }
      await db.from('official_feed_posts').update(patch).eq('post_id', postId)
    }
    await db.from('posts').update(updates).eq('id', postId)
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === 'publish') {
    const now = new Date().toISOString()
    await db.from('posts').update({ status: 'published', published_at: now, updated_at: now, is_archived: false }).eq('id', postId)
    await db.from('official_feed_posts').update({ approved_at: now, approved_by: gate.session.phone, is_auto_published: false, updated_at: now, archived_at: null, archived_reason: null }).eq('post_id', postId)
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === 'reject' || parsed.data.action === 'archive') {
    const reason = parsed.data.action === 'reject' ? 'Rejected by super-admin' : 'Archived by super-admin'
    await archiveOfficialPost(db, postId, reason)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  return POST(req)
}
