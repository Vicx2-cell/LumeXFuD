import 'server-only'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import {
  DEFAULT_FEED_AUTOMATION_CONFIG,
  FEED_AUTOMATION_TEMPLATE_VERSION,
  automaticPostIdempotencyKey,
  findReachedMilestone,
  isVendorPostEligible,
  renderVendorAutomaticPost,
  type AutomaticPostType,
  type FeedAutomationConfig,
  type VendorAutomaticPostType,
  type VendorPostFacts,
} from './automation'

type DB = ReturnType<typeof createSupabaseAdmin>
type JsonRow = Record<string, unknown>

type OutboxRow = {
  id: string
  event_key: string
  event_type: string
  source_entity_type: string
  source_entity_id: string
  vendor_id: string | null
  city_id: string | null
  zone_id: string | null
  payload: JsonRow | null
  attempts: number
}

const VENDOR_TYPES = new Set<VendorAutomaticPostType>([
  'vendor_welcome', 'new_menu_item', 'item_back_in_stock', 'price_drop',
  'new_bundle', 'popular_item', 'vendor_reopened', 'order_milestone',
])

function asInteger(value: unknown, fallback: number) {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : fallback
}

function enabledTypes(value: unknown): ReadonlySet<AutomaticPostType> {
  if (!value || typeof value !== 'object') return DEFAULT_FEED_AUTOMATION_CONFIG.enabledPostTypes
  return new Set(Object.entries(value as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([type]) => type as AutomaticPostType))
}

export async function loadFeedAutomationConfig(db: DB = createSupabaseAdmin()): Promise<FeedAutomationConfig> {
  const { data } = await db.from('feed_automation_settings').select('*').eq('id', 'global').maybeSingle()
  const row = (data ?? {}) as JsonRow
  return {
    enabled: row.enabled === true,
    vendorDailyLimit: asInteger(row.vendor_daily_limit, DEFAULT_FEED_AUTOMATION_CONFIG.vendorDailyLimit),
    officialAreaWindowLimit: asInteger(row.official_area_window_limit, DEFAULT_FEED_AUTOMATION_CONFIG.officialAreaWindowLimit),
    duplicateTopicCooldownHours: asInteger(row.duplicate_topic_cooldown_hours, DEFAULT_FEED_AUTOMATION_CONFIG.duplicateTopicCooldownHours),
    menuBatchWindowMinutes: asInteger(row.menu_batch_window_minutes, DEFAULT_FEED_AUTOMATION_CONFIG.menuBatchWindowMinutes),
    vendorReopenMinimumHours: asInteger(row.vendor_reopen_minimum_hours, DEFAULT_FEED_AUTOMATION_CONFIG.vendorReopenMinimumHours),
    priceDropMinimumBps: asInteger(row.price_drop_minimum_bps, DEFAULT_FEED_AUTOMATION_CONFIG.priceDropMinimumBps),
    priceDropMinimumKobo: asInteger(row.price_drop_minimum_kobo, DEFAULT_FEED_AUTOMATION_CONFIG.priceDropMinimumKobo),
    backInStockMinimumOrders: asInteger(row.back_in_stock_minimum_orders, DEFAULT_FEED_AUTOMATION_CONFIG.backInStockMinimumOrders),
    popularityMinimumOrders: asInteger(row.popularity_minimum_orders, DEFAULT_FEED_AUTOMATION_CONFIG.popularityMinimumOrders),
    anonymityMinimumOrders: asInteger(row.anonymity_minimum_orders, DEFAULT_FEED_AUTOMATION_CONFIG.anonymityMinimumOrders),
    orderAggregationHours: asInteger(row.order_aggregation_hours, DEFAULT_FEED_AUTOMATION_CONFIG.orderAggregationHours),
    affordabilityMaxItemKobo: asInteger(row.affordability_max_item_kobo, DEFAULT_FEED_AUTOMATION_CONFIG.affordabilityMaxItemKobo),
    affordabilityMaxMealKobo: asInteger(row.affordability_max_meal_kobo, DEFAULT_FEED_AUTOMATION_CONFIG.affordabilityMaxMealKobo),
    collectionItemCount: asInteger(row.collection_item_count, DEFAULT_FEED_AUTOMATION_CONFIG.collectionItemCount),
    enabledPostTypes: enabledTypes(row.enabled_post_types),
    milestoneValues: Array.isArray(row.milestone_values)
      ? row.milestone_values.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)
      : DEFAULT_FEED_AUTOMATION_CONFIG.milestoneValues,
  }
}

export async function enqueueFeedAutomationEvent(input: {
  eventKey: string
  eventType: string
  sourceEntityType: string
  sourceEntityId: string
  vendorId?: string | null
  cityId?: string | null
  zoneId?: string | null
  payload?: JsonRow
}, db: DB = createSupabaseAdmin()) {
  const { error } = await db.from('feed_automation_outbox').insert({
    event_key: input.eventKey,
    event_type: input.eventType,
    source_entity_type: input.sourceEntityType,
    source_entity_id: input.sourceEntityId,
    vendor_id: input.vendorId ?? null,
    city_id: input.cityId ?? null,
    zone_id: input.zoneId ?? null,
    payload: input.payload ?? {},
  })
  if (error && error.code !== '23505') throw new Error(error.message)
}

async function audit(db: DB, row: OutboxRow, action: string, reason: string, postId?: string, metadata: JsonRow = {}) {
  await db.from('feed_generation_audit').insert({
    outbox_id: row.id, post_id: postId ?? null, action, reason,
    actor_type: 'system', actor_id: 'feed-automation-worker', metadata,
  })
}

async function finish(db: DB, row: OutboxRow, status: 'completed' | 'suppressed', reason: string, postId?: string) {
  await db.from('feed_automation_outbox').update({
    status, completed_at: new Date().toISOString(), last_error: status === 'suppressed' ? reason : null,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id)
  await audit(db, row, status === 'completed' ? 'published' : 'suppressed', reason, postId)
}

async function fail(db: DB, row: OutboxRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const dead = row.attempts >= 5
  const retryMinutes = Math.min(240, 2 ** Math.max(1, row.attempts))
  await db.from('feed_automation_outbox').update({
    status: dead ? 'dead' : 'retry',
    last_error: message.slice(0, 1_000),
    available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', row.id)
  await audit(db, row, dead ? 'failed' : 'retried', message, undefined, { retry_minutes: retryMinutes })
}

async function loadVerifiedItemOrders(db: DB, itemId: string): Promise<number> {
  const { data: lines } = await db.from('order_items').select('order_id').eq('menu_item_id', itemId).limit(2_000)
  const ids = [...new Set((lines ?? []).map((line) => String((line as { order_id: string }).order_id)))]
  if (!ids.length) return 0
  const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
    .in('id', ids).eq('payment_status', 'PAID').in('status', ['DELIVERED', 'COMPLETED'])
    .eq('is_test_order', false).eq('fraud_flagged', false)
  return count ?? 0
}

async function loadFacts(db: DB, row: OutboxRow, type: VendorAutomaticPostType, config: FeedAutomationConfig) {
  if (!row.vendor_id) return null
  const [{ data: vendor }, { data: vendorSetting }, { count: availableCount }] = await Promise.all([
    db.from('vendors').select('id, shop_name, slug, approval_state, is_active, status, city_id, zone_id, storefront_photo_url, shop_photo_url, logo_url, official_latitude, official_longitude, latitude, longitude, feed_closed_at, deleted_at').eq('id', row.vendor_id).maybeSingle(),
    db.from('vendor_feed_automation_settings').select('optional_marketing_enabled, automation_paused, disabled_post_types').eq('vendor_id', row.vendor_id).maybeSingle(),
    db.from('menu_items').select('id', { count: 'exact', head: true }).eq('vendor_id', row.vendor_id).eq('is_available', true).is('deleted_at', null),
  ])
  if (!vendor) return null
  const v = vendor as JsonRow
  const settings = (vendorSetting ?? {}) as JsonRow
  const itemNeeded = !['vendor_welcome', 'vendor_reopened', 'order_milestone', 'new_bundle'].includes(type)
  let item: JsonRow | null = null
  let bundle: JsonRow | null = null
  if (itemNeeded) {
    const { data } = await db.from('menu_items').select('id, name, price_kobo, image_url, is_available, deleted_at')
      .eq('id', row.source_entity_id).eq('vendor_id', row.vendor_id).maybeSingle()
    item = data as JsonRow | null
  }
  if (type === 'new_bundle') {
    const { data } = await db.from('menu_bundles')
      .select('id, name, price_kobo, image_url, is_active, deleted_at, primary_menu_item_id')
      .eq('id', row.source_entity_id).eq('vendor_id', row.vendor_id).maybeSingle()
    bundle = data as JsonRow | null
    if (bundle?.primary_menu_item_id) {
      const { data: primary } = await db.from('menu_items')
        .select('id, name, price_kobo, image_url, is_available, deleted_at')
        .eq('id', String(bundle.primary_menu_item_id)).eq('vendor_id', row.vendor_id).maybeSingle()
      item = primary as JsonRow | null
    }
  }
  const completedOrdersResult = type === 'order_milestone'
    ? await db.from('orders').select('id', { count: 'exact', head: true }).eq('vendor_id', row.vendor_id)
      .eq('payment_status', 'PAID').in('status', ['DELIVERED', 'COMPLETED'])
      .eq('is_test_order', false).eq('fraud_flagged', false)
    : { count: null }
  const completedVendorOrders = completedOrdersResult.count ?? 0
  const milestone = findReachedMilestone(completedVendorOrders, config.milestoneValues)
  const facts: VendorPostFacts = {
    vendorId: row.vendor_id,
    vendorName: String(v.shop_name ?? '').trim(),
    vendorApproved: v.approval_state === 'approved' && !v.deleted_at,
    vendorActive: v.is_active === true,
    storefrontComplete: Boolean(
      String(v.shop_name ?? '').trim() &&
      (v.storefront_photo_url || v.shop_photo_url || v.logo_url) &&
      ((v.official_latitude != null && v.official_longitude != null) || (v.latitude != null && v.longitude != null))
    ),
    automationPaused: settings.automation_paused === true,
    optionalMarketingEnabled: settings.optional_marketing_enabled !== false,
    availableMenuItemCount: availableCount ?? 0,
    itemId: item ? String(item.id) : null,
    itemName: item ? String(item.name ?? '') : null,
    itemPriceKobo: item ? Number(item.price_kobo) : null,
    itemAvailable: item?.is_available === true && !item.deleted_at,
    itemImageUrl: item ? String(item.image_url ?? '') || null : null,
    bundleId: bundle ? String(bundle.id) : null,
    bundleName: bundle ? String(bundle.name ?? '') : null,
    bundlePriceKobo: bundle ? Number(bundle.price_kobo) : null,
    bundleActive: bundle?.is_active === true && !bundle.deleted_at && item?.is_available === true && !item?.deleted_at,
    bundlePrimaryMenuItemId: bundle?.primary_menu_item_id ? String(bundle.primary_menu_item_id) : null,
    previousPriceKobo: Number(row.payload?.previous_price_kobo ?? Number.NaN),
    verifiedItemOrders: item ? await loadVerifiedItemOrders(db, String(item.id)) : 0,
    completedVendorOrders,
    milestone: milestone ?? undefined,
    vendorClosedHours: v.feed_closed_at
      ? Math.max(0, (Date.now() - new Date(String(v.feed_closed_at)).getTime()) / 3_600_000)
      : null,
  }
  const disabled = Array.isArray(settings.disabled_post_types) && settings.disabled_post_types.includes(type)
  return { facts, vendor: v, item, bundle, disabled }
}

async function ensureVendorProfile(db: DB, facts: VendorPostFacts, vendor: JsonRow) {
  const { data: existing } = await db.from('social_profiles').select('id').eq('vendor_id', facts.vendorId).maybeSingle()
  if (existing) return String(existing.id)
  const base = String(vendor.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || `vendor-${facts.vendorId.slice(0, 8)}`
  const { data, error } = await db.from('social_profiles').insert({
    vendor_id: facts.vendorId,
    profile_kind: 'vendor',
    handle: `${base}-${facts.vendorId.slice(0, 6)}`.slice(0, 50),
    display_name: facts.vendorName,
    avatar_url: vendor.logo_url ?? vendor.shop_photo_url ?? null,
    campus_id: vendor.city_id ?? null,
    zone_id: vendor.zone_id ?? null,
    is_verified: true,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create vendor feed profile')
  return String(data.id)
}

async function publishVendorPost(
  db: DB,
  row: OutboxRow,
  type: VendorAutomaticPostType,
  facts: VendorPostFacts,
  vendor: JsonRow,
  config: FeedAutomationConfig,
) {
  const eligibility = isVendorPostEligible(type, facts, config)
  if (!eligibility.eligible) return { published: false as const, reason: eligibility.reason }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const { count: dailyCount } = await db.from('posts').select('id', { count: 'exact', head: true })
    .eq('vendor_id', facts.vendorId).eq('generation_mode', 'automatic').gte('generated_at', today.toISOString())
  if ((dailyCount ?? 0) >= config.vendorDailyLimit) {
    return { published: false as const, reason: 'vendor daily automatic-post limit reached' }
  }
  const discriminator = type === 'order_milestone' ? String(facts.milestone) : 'once'
  const idempotencyKey = automaticPostIdempotencyKey(type, type === 'vendor_welcome' ? facts.vendorId : row.source_entity_id, discriminator)
  const { data: duplicate } = await db.from('posts').select('id').eq('idempotency_key', idempotencyKey).maybeSingle()
  if (duplicate) return { published: false as const, reason: 'event already produced a post' }
  const cooldownStart = new Date(Date.now() - config.duplicateTopicCooldownHours * 3_600_000).toISOString()
  const { data: similar } = await db.from('posts').select('id').eq('vendor_id', facts.vendorId)
    .eq('automatic_post_type', type).eq('status', 'published').gte('generated_at', cooldownStart).limit(1)
  if ((similar ?? []).length && !['vendor_welcome', 'order_milestone'].includes(type)) {
    return { published: false as const, reason: 'similar active topic is in cooldown' }
  }
  const profileId = await ensureVendorProfile(db, facts, vendor)
  const now = new Date().toISOString()
  const { data: post, error } = await db.from('posts').insert({
    author_profile_id: profileId,
    vendor_id: facts.vendorId,
    related_menu_item_id: facts.itemId ?? null,
    post_kind: facts.itemId ? 'MENU_ITEM' : 'TEXT',
    status: 'published',
    visibility: 'public',
    audience_scope: 'customers',
    body: renderVendorAutomaticPost(type, facts),
    campus_id: vendor.city_id ?? null,
    zone_id: vendor.zone_id ?? null,
    generation_mode: 'automatic',
    automatic_post_type: type,
    source_event_type: row.event_type,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    idempotency_key: idempotencyKey,
    area_scope: vendor.zone_id ? 'delivery_area' : 'city',
    area_id: vendor.zone_id ?? vendor.city_id ?? null,
    generated_at: now,
    published_at: now,
    template_version: FEED_AUTOMATION_TEMPLATE_VERSION,
    moderation_status: 'approved',
    link_target_type: facts.bundleId ? 'bundle' : facts.itemId ? 'menu_item' : 'storefront',
    link_target_id: facts.bundleId ?? facts.itemId ?? facts.vendorId,
    cta_enabled: true,
  }).select('id').single()
  if (error || !post) throw new Error(error?.message ?? 'Automatic post insert failed')
  if (facts.itemId && facts.itemName && facts.itemPriceKobo != null) {
    const { error: linkError } = await db.from('post_menu_items').insert({
      post_id: post.id,
      menu_item_id: facts.itemId,
      menu_item_name_snapshot: facts.itemName,
      menu_item_price_kobo_snapshot: facts.itemPriceKobo,
      menu_item_image_url_snapshot: facts.itemImageUrl ?? null,
      is_primary: true,
      is_available_snapshot: true,
      order_label: 'View menu',
    })
    if (linkError) {
      await db.from('posts').update({ status: 'archived', is_archived: true, archived_at: now, archived_reason: 'failed to link source item', cta_enabled: false }).eq('id', post.id)
      throw new Error(linkError.message)
    }
  }
  return { published: true as const, postId: String(post.id), reason: eligibility.reason }
}

async function processJob(db: DB, row: OutboxRow, config: FeedAutomationConfig) {
  if (!config.enabled) return finish(db, row, 'suppressed', 'automation kill switch is off')
  if (row.event_type === 'order_completed') {
    const { data: sourceOrder } = await db.from('orders')
      .select('status, payment_status, is_test_order, fraud_flagged')
      .eq('id', row.source_entity_id).maybeSingle()
    if (!sourceOrder || sourceOrder.payment_status !== 'PAID' ||
      !['DELIVERED', 'COMPLETED'].includes(sourceOrder.status) ||
      sourceOrder.is_test_order || sourceOrder.fraud_flagged) {
      return finish(db, row, 'suppressed', 'order is not a valid private aggregation source')
    }
    const { data: orderLines } = await db.from('order_items').select('menu_item_id')
      .eq('order_id', row.source_entity_id).not('menu_item_id', 'is', null)
    for (const itemId of [...new Set((orderLines ?? []).map((line) => String((line as { menu_item_id: string }).menu_item_id)))]) {
      const itemEvent = { ...row, source_entity_type: 'menu_items', source_entity_id: itemId, event_type: 'popular_item' }
      const itemLoaded = await loadFacts(db, itemEvent, 'popular_item', config)
      if (!itemLoaded || itemLoaded.disabled) continue
      const popular = await publishVendorPost(db, itemEvent, 'popular_item', itemLoaded.facts, itemLoaded.vendor, config)
      if (popular.published) {
        await audit(db, row, 'published', popular.reason, popular.postId, {
          automatic_post_type: 'popular_item', menu_item_id: itemId,
        })
      }
    }
  }
  const type: VendorAutomaticPostType | null = VENDOR_TYPES.has(row.event_type as VendorAutomaticPostType)
    ? row.event_type as VendorAutomaticPostType
    : row.event_type === 'order_completed' ? 'order_milestone' : null
  if (!type) return finish(db, row, 'suppressed', 'event has no vendor automatic post mapping')
  const loaded = await loadFacts(db, row, type, config)
  if (!loaded) return finish(db, row, 'suppressed', 'source vendor no longer exists')

  // Any eligible vendor/menu event is also an opportunity to create the one-time
  // welcome post after approval and menu availability converge.
  if (type !== 'vendor_welcome') {
    const welcome = await publishVendorPost(db, row, 'vendor_welcome', loaded.facts, loaded.vendor, config)
    if (welcome.published) await audit(db, row, 'published', welcome.reason, welcome.postId, { automatic_post_type: 'vendor_welcome' })
  }
  if (loaded.disabled) return finish(db, row, 'suppressed', 'vendor disabled this optional post type')
  if (type === 'order_milestone' && !loaded.facts.milestone) {
    return finish(db, row, 'suppressed', 'completed order did not reach a configured milestone')
  }
  const result = await publishVendorPost(db, row, type, loaded.facts, loaded.vendor, config)
  return finish(db, row, result.published ? 'completed' : 'suppressed', result.reason, result.published ? result.postId : undefined)
}

export async function reconcileAutomaticPostActions(db: DB = createSupabaseAdmin()) {
  const now = new Date().toISOString()
  const { data: expiredPins } = await db.from('feed_post_pins').select('id, post_id')
    .is('unpinned_at', null).lte('expires_at', now)
  for (const pin of expiredPins ?? []) {
    await db.from('feed_post_pins').update({ unpinned_at: now, unpinned_by: 'system:expiry' }).eq('id', pin.id)
    const { count } = await db.from('feed_post_pins').select('id', { count: 'exact', head: true })
      .eq('post_id', pin.post_id).is('unpinned_at', null)
    await db.from('posts').update({ is_pinned: (count ?? 0) > 0 }).eq('id', pin.post_id)
    await db.from('feed_generation_audit').insert({ post_id: pin.post_id, action: 'pin_expired', reason: 'configured pin expiry reached', actor_type: 'system', actor_id: 'feed-automation-worker' })
  }
  const { data: linked } = await db.from('posts').select('id, related_menu_item_id, vendor_id')
    .eq('generation_mode', 'automatic').eq('cta_enabled', true).eq('status', 'published').limit(500)
  for (const post of linked ?? []) {
    if (!post.related_menu_item_id) continue
    const [{ data: item }, { data: vendor }] = await Promise.all([
      db.from('menu_items').select('is_available, deleted_at').eq('id', post.related_menu_item_id).maybeSingle(),
      db.from('vendors').select('is_active, approval_state, deleted_at').eq('id', post.vendor_id).maybeSingle(),
    ])
    if (!item || item.deleted_at || !item.is_available || !vendor || vendor.deleted_at || !vendor.is_active || vendor.approval_state !== 'approved') {
      await db.from('posts').update({ cta_enabled: false, updated_at: now }).eq('id', post.id)
      await db.from('feed_generation_audit').insert({ post_id: post.id, action: 'cta_disabled', reason: 'linked item or vendor is no longer orderable', actor_type: 'system', actor_id: 'feed-automation-worker' })
    }
  }
  return { expiredPins: expiredPins?.length ?? 0 }
}

export async function runFeedAutomationWorker(limit = 20, db: DB = createSupabaseAdmin()) {
  const config = await loadFeedAutomationConfig(db)
  if (!config.enabled) return { paused: true, claimed: 0, completed: 0, suppressed: 0, failed: 0, expiredPins: 0 }
  const { data, error } = await db.rpc('claim_feed_automation_jobs', { p_limit: limit })
  if (error) throw new Error(error.message)
  const jobs = (data ?? []) as OutboxRow[]
  let completed = 0
  let suppressed = 0
  let failed = 0
  for (const row of jobs) {
    try {
      await processJob(db, row, config)
      const { data: state } = await db.from('feed_automation_outbox').select('status').eq('id', row.id).single()
      if (state?.status === 'completed') completed += 1
      else suppressed += 1
    } catch (error) {
      failed += 1
      await fail(db, row, error)
    }
  }
  const reconciliation = await reconcileAutomaticPostActions(db)
  return { claimed: jobs.length, completed, suppressed, failed, ...reconciliation }
}
