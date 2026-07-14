import { createSupabaseAdmin } from '@/lib/supabase/server'
import { type OfficialAreaConfig, type OfficialCollectionPlan } from './official'

export const OFFICIAL_SYSTEM_ACCOUNT_KEY = 'lumex_fud'
export const OFFICIAL_SYSTEM_HANDLE = 'lumex-fud-official'
export const OFFICIAL_SYSTEM_DISPLAY_NAME = 'LumeX Fud'
export const OFFICIAL_SYSTEM_AVATAR_URL = '/icons/icon-512-v2.png'

type DB = ReturnType<typeof createSupabaseAdmin>

export interface OfficialAreaSettingRow extends OfficialAreaConfig {
  id: string
  cityId: string | null
  zoneId: string | null
  updatedBy: string | null
  updatedAt: string
}

export interface OfficialFeedPostRow {
  id: string
  post_id: string
  area_scope: 'city' | 'zone'
  area_id: string
  collection_type: OfficialCollectionPlan['collectionType']
  source_type: string
  source_id: string
  generation_reason: string
  selection_metadata: Record<string, unknown>
  dedupe_key: string
  content_hash: string
  is_auto_published: boolean
  approved_at: string | null
  approved_by: string | null
  archived_at: string | null
  archived_reason: string | null
  created_at: string
  updated_at: string
}

function mapAreaRow(row: Record<string, unknown>): OfficialAreaSettingRow {
  return {
    id: String(row.id),
    cityId: (row.city_id as string | null) ?? null,
    zoneId: (row.zone_id as string | null) ?? null,
    areaScope: String(row.area_scope) as 'city' | 'zone',
    areaId: String((row.city_id as string | null) ?? (row.zone_id as string | null) ?? ''),
    areaLabel: String(row.area_label ?? ''),
    morningEnabled: Boolean(row.morning_enabled),
    eveningEnabled: Boolean(row.evening_enabled),
    autoPublish: Boolean(row.auto_publish),
    lateNightStart: String(row.late_night_start ?? '22:00'),
    minPopularityOrders: Number(row.min_popularity_orders ?? 10),
    priceThresholdKobo: Number(row.price_threshold_kobo ?? 300000),
    maxPostsPerDay: Number(row.max_posts_per_day ?? 2),
    maxCollectionItems: Number(row.max_collection_items ?? 5),
    picksMaxPerDay: Number(row.picks_max_per_day ?? 2),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    morningCron: String(row.morning_cron ?? '0 7 * * *'),
    eveningCron: String(row.evening_cron ?? '0 19 * * *'),
  } as unknown as OfficialAreaSettingRow
}

export async function ensureOfficialAccount(db: DB = createSupabaseAdmin()) {
  const now = new Date().toISOString()
  const { data: existing } = await db
    .from('social_profiles')
    .select('id, handle, display_name, avatar_url, is_system_account, system_account_key')
    .eq('system_account_key', OFFICIAL_SYSTEM_ACCOUNT_KEY)
    .maybeSingle()

  if (existing) {
    const { data: updated } = await db
      .from('social_profiles')
      .update({
        handle: OFFICIAL_SYSTEM_HANDLE,
        display_name: OFFICIAL_SYSTEM_DISPLAY_NAME,
        avatar_url: OFFICIAL_SYSTEM_AVATAR_URL,
        profile_kind: 'admin',
        is_system_account: true,
        official_badge_kind: 'official',
        profile_locked_at: now,
        deleted_at: null,
        updated_at: now,
      })
      .eq('id', (existing as { id: string }).id)
      .select('id, handle, display_name, avatar_url, is_system_account, system_account_key')
      .single()
    return updated as {
      id: string
      handle: string
      display_name: string
      avatar_url: string | null
      is_system_account: boolean
      system_account_key: string | null
    }
  }

  const { data, error } = await db
    .from('social_profiles')
    .insert({
      customer_id: null,
      vendor_id: null,
      rider_id: null,
      admin_id: null,
      profile_kind: 'admin',
      handle: OFFICIAL_SYSTEM_HANDLE,
      display_name: OFFICIAL_SYSTEM_DISPLAY_NAME,
      avatar_url: OFFICIAL_SYSTEM_AVATAR_URL,
      is_system_account: true,
      system_account_key: OFFICIAL_SYSTEM_ACCOUNT_KEY,
      official_badge_kind: 'official',
      profile_locked_at: now,
      is_verified: true,
      updated_at: now,
    })
    .select('id, handle, display_name, avatar_url, is_system_account, system_account_key')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Could not create official account')
  return data as {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_system_account: boolean
    system_account_key: string | null
  }
}

export async function loadOfficialAreaSettings(db: DB = createSupabaseAdmin()) {
  const { data } = await db
    .from('official_feed_area_settings')
    .select('id, city_id, zone_id, area_scope, area_label, morning_enabled, evening_enabled, auto_publish, morning_cron, evening_cron, late_night_start, min_popularity_orders, price_threshold_kobo, max_posts_per_day, max_collection_items, picks_max_per_day, updated_by, updated_at')
    .order('area_scope', { ascending: true })
    .order('area_label', { ascending: true })
  return (data ?? []).map((row) => mapAreaRow(row as Record<string, unknown>))
}

export async function upsertOfficialAreaSetting(
  db: DB,
  input: {
    cityId?: string | null
    zoneId?: string | null
    areaScope: 'city' | 'zone'
    areaLabel: string
    morningEnabled?: boolean
    eveningEnabled?: boolean
    autoPublish?: boolean
    morningCron?: string
    eveningCron?: string
    lateNightStart?: string
    minPopularityOrders?: number
    priceThresholdKobo?: number
    maxPostsPerDay?: number
    maxCollectionItems?: number
    picksMaxPerDay?: number
    updatedBy: string
  },
) {
  const now = new Date().toISOString()
  const payload = {
    city_id: input.cityId ?? null,
    zone_id: input.zoneId ?? null,
    area_scope: input.areaScope,
    area_label: input.areaLabel,
    morning_enabled: input.morningEnabled ?? true,
    evening_enabled: input.eveningEnabled ?? true,
    auto_publish: input.autoPublish ?? false,
    morning_cron: input.morningCron ?? '0 7 * * *',
    evening_cron: input.eveningCron ?? '0 19 * * *',
    late_night_start: input.lateNightStart ?? '22:00',
    min_popularity_orders: Math.max(0, Math.round(input.minPopularityOrders ?? 10)),
    price_threshold_kobo: Math.max(0, Math.round(input.priceThresholdKobo ?? 300000)),
    max_posts_per_day: Math.max(1, Math.round(input.maxPostsPerDay ?? 2)),
    max_collection_items: Math.max(1, Math.round(input.maxCollectionItems ?? 5)),
    picks_max_per_day: Math.max(1, Math.round(input.picksMaxPerDay ?? 2)),
    updated_by: input.updatedBy,
    updated_at: now,
  }

  const { data, error } = await db
    .from('official_feed_area_settings')
    .upsert(payload, { onConflict: 'area_scope,city_id,zone_id' })
    .select('id, city_id, zone_id, area_scope, area_label, morning_enabled, evening_enabled, auto_publish, morning_cron, evening_cron, late_night_start, min_popularity_orders, price_threshold_kobo, max_posts_per_day, max_collection_items, picks_max_per_day, updated_by, updated_at')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Could not save official feed settings')
  return mapAreaRow(data as Record<string, unknown>)
}

function prettyBody(plan: OfficialCollectionPlan) {
  return [plan.title, plan.subtitle].filter(Boolean).join('\n')
}

export async function persistOfficialCollection(
  db: DB,
  input: {
    plan: OfficialCollectionPlan
    areaSettingId?: string | null
    publish: boolean
    sourceReason?: string
    approvedBy?: string | null
  },
) {
  const account = await ensureOfficialAccount(db)
  const now = new Date().toISOString()
  const existing = await db
    .from('official_feed_posts')
    .select('post_id, archived_at, dedupe_key, content_hash, is_auto_published, approved_at, approved_by')
    .eq('dedupe_key', input.plan.dedupeKey)
    .maybeSingle()

  if (existing.data) {
    return {
      created: false,
      postId: String((existing.data as { post_id: string }).post_id),
      deduped: true,
      accountId: account.id,
    }
  }

  const postStatus = input.publish ? 'published' : 'draft'
  const postPublishedAt = input.publish ? now : null
  const { data: post, error: postError } = await db.from('posts').insert({
    author_profile_id: account.id,
    vendor_id: null,
    post_kind: 'MENU_ITEM',
    status: postStatus,
    visibility: 'public',
    audience_scope: 'all',
    body: prettyBody(input.plan),
    content_warning: null,
    campus_id: input.plan.areaScope === 'city' ? input.plan.areaId : null,
    zone_id: input.plan.areaScope === 'zone' ? input.plan.areaId : null,
    location_text: input.plan.collectionType === 'evening_collection' ? input.plan.subtitle : input.plan.title,
    hashtags_cached: [],
    published_at: postPublishedAt,
    is_sponsored: input.plan.collectionType === 'sponsored',
    is_boosted: false,
    is_archived: false,
    is_pinned: false,
    updated_at: now,
  }).select('id').single()

  if (postError || !post) throw new Error(postError?.message ?? 'Could not create official post')

  const postId = String((post as { id: string }).id)
  const menuRows = input.plan.items.map((item, index) => ({
    post_id: postId,
    menu_item_id: item.menuItemId,
    menu_item_name_snapshot: item.itemName,
    menu_item_price_kobo_snapshot: item.priceKobo,
    menu_item_image_url_snapshot: item.imageUrl,
    is_primary: index === 0,
    order_label: index === 0 ? 'Featured' : null,
    is_available_snapshot: item.availabilityLabel === 'Available now',
  }))

  await db.from('post_menu_items').insert(menuRows)
  const { error: metaError } = await db.from('official_feed_posts').insert({
    post_id: postId,
    area_setting_id: input.areaSettingId ?? null,
    area_scope: input.plan.areaScope,
    area_id: input.plan.areaId,
    collection_type: input.plan.collectionType,
    source_type: input.plan.sourceType,
    source_id: input.plan.sourceId,
    generation_reason: input.plan.generationReason,
    selection_metadata: input.plan.selectionMetadata,
    dedupe_key: input.plan.dedupeKey,
    content_hash: input.plan.contentHash,
    is_auto_published: input.publish,
    approved_by: input.approvedBy ?? null,
    approved_at: input.publish ? now : null,
    updated_at: now,
  })
  if (metaError) throw new Error(metaError.message)

  return {
    created: true,
    deduped: false,
    postId,
    accountId: account.id,
  }
}

export async function archiveOfficialPost(
  db: DB,
  postId: string,
  reason: string,
) {
  const now = new Date().toISOString()
  await db.from('posts').update({
    status: 'archived',
    is_archived: true,
    archived_at: now,
    updated_at: now,
  }).eq('id', postId)
  await db.from('official_feed_posts').update({
    archived_at: now,
    archived_reason: reason,
    updated_at: now,
  }).eq('post_id', postId)
  return { postId, archived: true }
}

export async function archiveOfficialPostsForSource(
  db: DB,
  sourceType: string,
  sourceId: string,
  reason: string,
) {
  const { data } = await db
    .from('official_feed_posts')
    .select('post_id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .is('archived_at', null)
  const postIds = (data ?? []).map((row) => String((row as { post_id: string }).post_id))
  const results = []
  for (const postId of postIds) {
    results.push(await archiveOfficialPost(db, postId, reason))
  }
  return results
}

export async function listOfficialFeedPosts(db: DB = createSupabaseAdmin(), limit = 50) {
  const { data } = await db
    .from('posts')
    .select('id, author_profile_id, body, status, visibility, published_at, created_at, is_archived, archived_at, post_menu_items ( id, menu_item_id, menu_item_name_snapshot, menu_item_price_kobo_snapshot, menu_item_image_url_snapshot, is_primary, is_available_snapshot ), official_feed_posts ( area_scope, area_id, collection_type, source_type, source_id, generation_reason, selection_metadata, dedupe_key, content_hash, is_auto_published, approved_at, approved_by, archived_at, archived_reason )')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}




