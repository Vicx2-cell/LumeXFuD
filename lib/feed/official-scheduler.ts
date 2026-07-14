import { createSupabaseAdmin } from '@/lib/supabase/server'
import { buildOfficialCollectionPlan, isLateNight, isSupportedPopularityClaim, type OfficialAreaConfig, type OfficialCollectionHistoryRow, type OfficialCollectionPlan, type OfficialSourceItem } from './official'
import { ensureOfficialAccount, loadOfficialAreaSettings, persistOfficialCollection, type OfficialAreaSettingRow } from './official-service'

type DB = ReturnType<typeof createSupabaseAdmin>

function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

async function loadHistory(db: DB, area: OfficialAreaConfig, limit = 25): Promise<OfficialCollectionHistoryRow[]> {
  const { data } = await db
    .from('official_feed_posts')
    .select('source_id, area_id, collection_type, created_at, posts!inner(author_profile_id)')
    .eq('area_id', area.areaId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((row) => ({
    vendorId: String((row as { posts?: { author_profile_id?: string } }).posts?.author_profile_id ?? ''),
    sourceId: String((row as { source_id: string }).source_id),
    areaId: String((row as { area_id: string }).area_id),
    collectionType: String((row as { collection_type: OfficialCollectionPlan['collectionType'] }).collection_type) as OfficialCollectionPlan['collectionType'],
    createdAt: String((row as { created_at: string }).created_at),
  }))
}

export async function getOfficialAreaSettingByScope(db: DB, areaScope: 'city' | 'zone', areaId: string) {
  const { data } = await db
    .from('official_feed_area_settings')
    .select('id, city_id, zone_id, area_scope, area_label, morning_enabled, evening_enabled, auto_publish, morning_cron, evening_cron, late_night_start, min_popularity_orders, price_threshold_kobo, max_posts_per_day, max_collection_items, picks_max_per_day, updated_by, updated_at')
    .eq('area_scope', areaScope)
    .eq(areaScope === 'city' ? 'city_id' : 'zone_id', areaId)
    .maybeSingle()
  return data ? (data as unknown as OfficialAreaSettingRow) : null
}

async function loadMenuCandidates(db: DB, area: OfficialAreaConfig): Promise<OfficialSourceItem[]> {
  const { data: vendorRows } = await db
    .from('vendors')
    .select('id, shop_name, is_active, approval_state, deleted_at, city_id, zone_id, avg_rating, total_ratings, created_at, opening_time, closing_time')
    .eq(area.areaScope === 'city' ? 'city_id' : 'zone_id', area.areaId)
    .is('deleted_at', null)

  const vendors = (vendorRows ?? []) as Array<{
    id: string
    shop_name: string
    is_active: boolean
    approval_state: string
    deleted_at: string | null
    city_id: string | null
    zone_id: string | null
    avg_rating?: number | null
    total_ratings?: number | null
    created_at?: string | null
    opening_time?: string | null
    closing_time?: string | null
  }>
  const approved = vendors.filter((vendor) => vendor.is_active && vendor.approval_state === 'approved')
  const vendorById = new Map(approved.map((vendor) => [vendor.id, vendor]))

  const { data: menuRows } = approved.length > 0
    ? await db
      .from('menu_items')
      .select('id, vendor_id, name, price_kobo, image_url, is_available, deleted_at, created_at, category')
      .in('vendor_id', approved.map((vendor) => vendor.id))
      .is('deleted_at', null)
    : { data: [] as unknown[] }

  return (menuRows ?? []).map((row) => {
    const item = row as {
      id: string
      vendor_id: string
      name: string
      price_kobo: number
      image_url: string | null
      is_available: boolean
      deleted_at: string | null
      created_at: string
      category?: string | null
    }
    const vendor = vendorById.get(item.vendor_id)
    return {
      id: item.id,
      vendorId: item.vendor_id,
      vendorName: vendor?.shop_name ?? 'Vendor',
    vendorHandle: null,
      itemName: item.name,
      priceKobo: Number(item.price_kobo ?? 0),
      imageUrl: item.image_url ?? null,
      imageBelongsToItem: Boolean(item.image_url),
      isAvailable: Boolean(item.is_available),
      vendorApproved: true,
      vendorActive: true,
      vendorVisible: true,
      servesArea: true,
      areaScope: area.areaScope,
      areaId: area.areaId,
      publishedAt: item.created_at,
      createdAt: item.created_at,
      vendorCreatedAt: vendor?.created_at ?? null,
      category: item.category ?? null,
      popularityOrders30d: Number(vendor?.total_ratings ?? 0),
      totalRatings: Number(vendor?.total_ratings ?? 0),
      avgRating: Number(vendor?.avg_rating ?? 0),
      openingTime: vendor?.opening_time ?? null,
      closingTime: vendor?.closing_time ?? null,
      sourceType: 'menu_item' as const,
      sourceId: item.id,
    } satisfies OfficialSourceItem
  })
}

async function loadDealCandidates(db: DB, area: OfficialAreaConfig): Promise<OfficialSourceItem[]> {
  const { data } = await db
    .from('post_promotions')
    .select('id, post_id, title, description, campaign_price_kobo, starts_at, ends_at, status, posts!inner(id, vendor_id, zone_id, campus_id, status, visibility, deleted_at, published_at, post_menu_items(menu_item_id, menu_item_name_snapshot, menu_item_price_kobo_snapshot, menu_item_image_url_snapshot, is_available_snapshot, is_primary))')
    .in('status', ['active', 'scheduled'])
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const out: OfficialSourceItem[] = []
  for (const row of rows) {
    const post = row.posts as Record<string, unknown> | undefined
    const postMenuItems = Array.isArray(post?.post_menu_items) ? post?.post_menu_items as Array<Record<string, unknown>> : []
    const primary = postMenuItems.find((item) => Boolean(item.is_primary)) ?? postMenuItems[0] ?? null
    const vendorId = post?.vendor_id as string | undefined
    if (!vendorId) continue
    const areaMatches = area.areaScope === 'city'
      ? String(post?.campus_id ?? '') === area.areaId
      : String(post?.zone_id ?? '') === area.areaId
    if (!areaMatches) continue
    const title = String((row.title as string | undefined) ?? primary?.menu_item_name_snapshot ?? 'Deal')
    const priceKobo = Number((row.campaign_price_kobo as number | undefined) ?? primary?.menu_item_price_kobo_snapshot ?? 0)
    out.push({
      id: String(row.id),
      vendorId,
      vendorName: 'Vendor',
      itemName: title,
      priceKobo,
      imageUrl: String(primary?.menu_item_image_url_snapshot ?? '') || null,
      imageBelongsToItem: Boolean(primary?.menu_item_image_url_snapshot),
      isAvailable: Boolean(primary?.is_available_snapshot ?? true),
      vendorApproved: true,
      vendorActive: true,
      vendorVisible: true,
      servesArea: true,
      areaScope: area.areaScope,
      areaId: area.areaId,
      publishedAt: row.starts_at ? String(row.starts_at) : row.created_at ? String(row.created_at) : new Date().toISOString(),
      createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
      dealEndsAt: row.ends_at ? String(row.ends_at) : null,
      dealActive: String(row.status) === 'active' || String(row.status) === 'scheduled',
      sourceType: 'deal',
      sourceId: String(row.id),
      popularityOrders30d: Number((post?.order_count as number | undefined) ?? 0),
      totalRatings: Number((post?.like_count as number | undefined) ?? 0),
      avgRating: 0,
    })
  }
  return out
}

function containsAny(input: string, terms: string[]) {
  const haystack = input.toLowerCase()
  return terms.some((term) => haystack.includes(term))
}

function topicMatches(item: OfficialSourceItem, terms: string[]) {
  const fields = [
    item.itemName,
    item.vendorName,
    item.category ?? '',
    item.vendorHandle ?? '',
  ].join(' ')
  return containsAny(fields, terms)
}

function isRecent(value?: string | null, days = 7) {
  if (!value) return false
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return false
  return Date.now() - time <= days * 24 * 60 * 60 * 1000
}

function buildTopicCandidates(
  area: OfficialAreaConfig,
  menuCandidates: OfficialSourceItem[],
  dealCandidates: OfficialSourceItem[],
  now: Date,
): Array<{ collectionType: OfficialCollectionPlan['collectionType']; source: OfficialSourceItem[]; reason: string }> {
  const morningHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour12: false,
    hour: '2-digit',
  }).format(now))

  const byTopic = {
    breakfast: menuCandidates.filter((item) => topicMatches(item, ['breakfast', 'egg', 'tea', 'coffee', 'porridge', 'bread'])),
    lunch: menuCandidates.filter((item) => topicMatches(item, ['rice', 'jollof', 'swallow', 'amala', 'semovita', 'eba', 'beans'])),
    dinner: menuCandidates.filter((item) => topicMatches(item, ['shawarma', 'pizza', 'burger', 'chicken', 'suya', 'noodles', 'dinner'])),
    budget: menuCandidates.filter((item) => item.priceKobo <= area.priceThresholdKobo),
    rice: menuCandidates.filter((item) => topicMatches(item, ['rice', 'jollof', 'fried rice', 'ofada', 'coconut rice'])),
    shawarma: menuCandidates.filter((item) => topicMatches(item, ['shawarma'])),
    pizza: menuCandidates.filter((item) => topicMatches(item, ['pizza'])),
    drinks: menuCandidates.filter((item) => topicMatches(item, ['drink', 'juice', 'zobo', 'smoothie', 'water', 'malt', 'soda'])),
    fastDelivery: menuCandidates.filter((item) => Number(item.popularityOrders30d ?? 0) >= Math.max(5, Math.round(area.minPopularityOrders / 2))),
    openNow: menuCandidates.filter((item) => item.isAvailable),
    closingSoon: menuCandidates.filter((item) => item.isAvailable && item.closingTime && item.openingTime && isRecent(item.vendorCreatedAt, 21)),
    newVendors: menuCandidates.filter((item) => isRecent(item.vendorCreatedAt, 10)),
    newMenus: menuCandidates.filter((item) => isRecent(item.createdAt, 7)),
    deals: dealCandidates,
  }

  const picks: Array<{ collectionType: OfficialCollectionPlan['collectionType']; source: OfficialSourceItem[]; reason: string }> = [
    { collectionType: morningHour < 10 ? 'breakfast_picks' : 'lunch_picks', source: byTopic.breakfast.length > 0 ? byTopic.breakfast : menuCandidates, reason: 'Time-of-day collection from real nearby menu items.' },
    { collectionType: morningHour < 14 ? 'student_budget' : 'open_right_now', source: byTopic.budget.length > 0 ? byTopic.budget : byTopic.openNow, reason: 'Budget or live-availability collection from real menus.' },
    { collectionType: 'rice_lovers', source: byTopic.rice, reason: 'Rice-focused collection from verified live menus.' },
    { collectionType: 'shawarma_picks', source: byTopic.shawarma, reason: 'Shawarma-focused collection from verified live menus.' },
    { collectionType: 'pizza_friday', source: byTopic.pizza, reason: 'Pizza-focused collection from verified live menus.' },
    { collectionType: 'drinks_around_you', source: byTopic.drinks, reason: 'Drink and side-item collection from verified live menus.' },
    { collectionType: 'fast_delivery_picks', source: byTopic.fastDelivery, reason: 'Fast-moving meals from live marketplace activity.' },
    { collectionType: 'new_vendors', source: byTopic.newVendors, reason: 'Recently approved vendors and first live items.' },
    { collectionType: 'new_menus_week', source: byTopic.newMenus, reason: 'New menu items added this week.' },
    { collectionType: 'active_deals', source: byTopic.deals, reason: 'Active deal posts from live vendor promotions.' },
    { collectionType: 'closing_soon', source: byTopic.closingSoon, reason: 'Meals from vendors that are approaching closing time.' },
    { collectionType: 'open_right_now', source: byTopic.openNow, reason: 'Live open-now items from verified vendors.' },
  ] as const

  return picks.filter((entry) => entry.source.length > 0)
}

async function countPublishedToday(db: DB, areaId: string, now: Date) {
  const start = `${dayKey(now)}T00:00:00.000Z`
  const end = `${dayKey(now)}T23:59:59.999Z`
  const { count } = await db
    .from('official_feed_posts')
    .select('id', { count: 'exact', head: true })
    .eq('area_id', areaId)
    .gte('created_at', start)
    .lte('created_at', end)
  return count ?? 0
}

function maybeBuildPlan(
  area: OfficialAreaConfig,
  collectionType: OfficialCollectionPlan['collectionType'],
  source: OfficialSourceItem[],
  history: OfficialCollectionHistoryRow[],
  generationReason: string,
  now: Date,
) {
  return buildOfficialCollectionPlan({
    collectionType,
    area,
    source,
    history,
    now,
    generationReason,
    sourceType: collectionType,
    sourceId: `${area.areaScope}:${area.areaId}:${collectionType}:${dayKey(now)}`,
  })
}

export async function createOfficialEventCollection(input: {
  area: OfficialAreaSettingRow
  source: OfficialSourceItem[]
  collectionType: 'new_on_lumex' | 'sponsored' | 'event'
  reason: string
  sourceId: string
  publish?: boolean
}) {
  const db = createSupabaseAdmin()
  const history = await loadHistory(db, input.area)
  const plan = buildOfficialCollectionPlan({
    collectionType: input.collectionType,
    area: input.area,
    source: input.source,
    history,
    generationReason: input.reason,
    sourceType: input.collectionType,
    sourceId: input.sourceId,
    now: new Date(),
  })
  if (!plan) return { created: false, deduped: false }
  return persistOfficialCollection(db, {
    plan,
    areaSettingId: input.area.id,
    publish: input.publish ?? false,
    approvedBy: input.area.updatedBy ?? null,
  })
}

async function hasPublishedToday(db: DB, areaId: string, collectionType: OfficialCollectionPlan['collectionType'], now: Date) {
  const start = `${dayKey(now)}T00:00:00.000Z`
  const end = `${dayKey(now)}T23:59:59.999Z`
  const { count } = await db
    .from('official_feed_posts')
    .select('id', { count: 'exact', head: true })
    .eq('area_id', areaId)
    .eq('collection_type', collectionType)
    .gte('created_at', start)
    .lte('created_at', end)
  return (count ?? 0) > 0
}

export async function runOfficialFeedScheduler(now = new Date()) {
  const db = createSupabaseAdmin()
  await ensureOfficialAccount(db)
  const configs = await loadOfficialAreaSettings(db)
  const results: Array<{ areaId: string; collectionType: string; created: boolean; deduped: boolean; postId?: string }> = []

  for (const area of configs) {
    const history = await loadHistory(db, area)
    const menuCandidates = await loadMenuCandidates(db, area)
    const dealCandidates = await loadDealCandidates(db, area)
    let remainingSlots = Math.max(0, area.maxPostsPerDay - await countPublishedToday(db, area.areaId, now))

    async function publishIfAllowed(
      collectionType: OfficialCollectionPlan['collectionType'],
      source: OfficialSourceItem[],
      reason: string,
      forceAutoPublish = area.autoPublish,
    ) {
      if (remainingSlots <= 0) return
      if (await hasPublishedToday(db, area.areaId, collectionType, now)) return
      const plan = maybeBuildPlan(area, collectionType, source, history, reason, now)
      if (!plan) return
      const saved = await persistOfficialCollection(db, {
        plan,
        areaSettingId: area.id,
        publish: forceAutoPublish,
        approvedBy: area.updatedBy,
      })
      results.push({ areaId: area.areaId, collectionType, created: saved.created, deduped: saved.deduped, postId: saved.postId })
      if (saved.created) remainingSlots -= 1
    }

    if (area.morningEnabled) {
      const breakfastSource = menuCandidates.filter((item) => item.priceKobo <= area.priceThresholdKobo && isSupportedPopularityClaim(item, area.minPopularityOrders))
      await publishIfAllowed(
        'breakfast_picks',
        breakfastSource.length > 0 ? breakfastSource : menuCandidates,
        'Breakfast collection built from verified live menu items.',
      )
    }

    if (area.eveningEnabled && isLateNight(now, area.lateNightStart)) {
      await publishIfAllowed(
        'evening_collection',
        menuCandidates,
        'Late-night collection from vendors and meals still genuinely available after the configured cutoff.',
      )
    }

    if (remainingSlots > 0) {
      const supported = menuCandidates.filter((item) => item.priceKobo <= area.priceThresholdKobo)
      const picksPool = supported.filter((item) => isSupportedPopularityClaim(item, area.minPopularityOrders))
      const pickSource = picksPool.length >= 3 ? picksPool : supported
      await publishIfAllowed(
        'lumex_picks',
        pickSource.length > 0 ? pickSource : menuCandidates,
        'LumeX Picks generated from verified live menu data and configured thresholds.',
      )
    }

    if (remainingSlots > 0) {
      await publishIfAllowed(
        'new_on_lumex',
        [...menuCandidates, ...dealCandidates],
        'New-on-LumeX post generated from recently approved live vendors, menu items, and active deals.',
      )
    }

    if (remainingSlots > 0) {
      const topicQueue = buildTopicCandidates(area, menuCandidates, dealCandidates, now)
      for (const candidate of topicQueue) {
        if (remainingSlots <= 0) break
        await publishIfAllowed(candidate.collectionType, candidate.source, candidate.reason)
      }
    }
  }

  return { ok: true, areas: configs.length, results }
}
