import { createSupabaseAdmin } from '@/lib/supabase/server'

export const FEED_ATTRIBUTION_RULE_VERSION = '2026-07-10.feed.attr.rule.v1'
export const FEED_ATTRIBUTION_ALGORITHM_VERSION = '2026-07-10.feed.attr.v1'

const EVENT_PRIORITIES: Record<string, number> = {
  impression: 0.15,
  qualified_impression: 0.22,
  video_start: 0.28,
  video_25: 0.34,
  video_50: 0.42,
  video_75: 0.52,
  video_100: 0.6,
  rewatch: 0.56,
  dwell: 0.2,
  profile_visit: 0.3,
  menu_click: 0.72,
  add_to_cart: 0.88,
  checkout_start: 0.96,
  share: 0.46,
  save: 0.4,
  like: 0.22,
  reply: 0.3,
  repost: 0.34,
  follow: 0.26,
}

const ATTRIBUTION_EVENT_TYPES = new Set(Object.keys(EVENT_PRIORITIES))

export interface FeedAttributionEvent {
  id: string
  post_id: string | null
  viewer_profile_id: string | null
  event_type: string
  source_tab: string | null
  created_at: string
  metadata?: Record<string, unknown>
}

export interface FeedAttributionPost {
  id: string
  vendor_id: string | null
  author_profile_id: string | null
  status?: string | null
  deleted_at?: string | null
  is_archived?: boolean | null
}

export interface FeedOrderAttributionInput {
  orderId: string
  orderVendorId: string
  customerProfileId: string | null
  completedAt: string
  totalAmountKobo: number
  events: FeedAttributionEvent[]
  posts: FeedAttributionPost[]
  windowMinutes: number
  minimumConfidence: number
  maxSources: number
}

export interface FeedAttributionCandidate {
  orderId: string
  postId: string
  viewerProfileId: string | null
  sourceEventId: string
  sourceEventType: string
  eventAt: string
  confidence: number
  revenueKobo: number
}

export interface FeedOrderContext {
  orderId: string
  vendorId: string
  customerProfileId: string | null
  completedAt: string
  totalAmountKobo: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function eventPriority(eventType: string): number {
  return EVENT_PRIORITIES[eventType] ?? 0
}

function scoreEvent(event: FeedAttributionEvent, completedAt: string, windowMinutes: number): number {
  const priority = eventPriority(event.event_type)
  const elapsedMs = Math.max(0, new Date(completedAt).getTime() - new Date(event.created_at).getTime())
  const windowMs = Math.max(1, windowMinutes * 60_000)
  const recency = clamp(1 - elapsedMs / windowMs, 0, 1)
  const score = priority * 0.75 + recency * 0.25
  return Math.round(score * 10_000) / 10_000
}

export function selectAttributionCandidates(input: FeedOrderAttributionInput): FeedAttributionCandidate[] {
  const completedAtMs = new Date(input.completedAt).getTime()
  const windowMs = Math.max(1, input.windowMinutes * 60_000)
  const windowStart = completedAtMs - windowMs

  const postMap = new Map(input.posts.map((post) => [post.id, post]))
  const perPost = new Map<string, FeedAttributionCandidate>()

  for (const event of input.events) {
    if (!event.post_id || !event.viewer_profile_id) continue
    if (!ATTRIBUTION_EVENT_TYPES.has(event.event_type)) continue
    const post = postMap.get(event.post_id)
    if (!post) continue
    if (post.vendor_id !== input.orderVendorId) continue
    if (post.deleted_at || post.is_archived || post.status === 'deleted' || post.status === 'rejected') continue
    if (input.customerProfileId && post.author_profile_id && post.author_profile_id === input.customerProfileId) continue
    const eventTime = new Date(event.created_at).getTime()
    if (!Number.isFinite(eventTime) || eventTime < windowStart || eventTime > completedAtMs) continue

    const confidence = scoreEvent(event, input.completedAt, input.windowMinutes)
    if (confidence < input.minimumConfidence) continue

    const candidate: FeedAttributionCandidate = {
      orderId: input.orderId,
      postId: post.id,
      viewerProfileId: event.viewer_profile_id,
      sourceEventId: event.id,
      sourceEventType: event.event_type,
      eventAt: event.created_at,
      confidence,
      revenueKobo: Math.max(0, input.totalAmountKobo),
    }
    const current = perPost.get(post.id)
    if (!current || candidate.confidence > current.confidence || (candidate.confidence === current.confidence && candidate.eventAt > current.eventAt)) {
      perPost.set(post.id, candidate)
    }
  }

  return Array.from(perPost.values())
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime()
    })
    .slice(0, input.maxSources)
}

async function loadAttributionRule(db: ReturnType<typeof createSupabaseAdmin>) {
  const { data } = await db
    .from('feed_attribution_rules')
    .select('rule_key, rule_version, algorithm_version, attribution_window_minutes, minimum_confidence, max_sources_per_order, enabled')
    .eq('enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) {
    return {
      ruleVersion: FEED_ATTRIBUTION_RULE_VERSION,
      algorithmVersion: FEED_ATTRIBUTION_ALGORITHM_VERSION,
      windowMinutes: 4320,
      minimumConfidence: 0.35,
      maxSources: 3,
    }
  }

  return {
    ruleVersion: String((data as { rule_version: string }).rule_version ?? FEED_ATTRIBUTION_RULE_VERSION),
    algorithmVersion: String((data as { algorithm_version: string }).algorithm_version ?? FEED_ATTRIBUTION_ALGORITHM_VERSION),
    windowMinutes: Number((data as { attribution_window_minutes: number }).attribution_window_minutes ?? 4320),
    minimumConfidence: Number((data as { minimum_confidence: number }).minimum_confidence ?? 0.35),
    maxSources: Number((data as { max_sources_per_order: number }).max_sources_per_order ?? 3),
  }
}

async function loadOrderContext(db: ReturnType<typeof createSupabaseAdmin>, orderId: string): Promise<FeedOrderContext | null> {
  const { data } = await db
    .from('orders')
    .select('id, vendor_id, customer_id, completed_at, total_amount, status')
    .eq('id', orderId)
    .maybeSingle()

  if (!data) return null
  return {
    orderId: String((data as { id: string }).id),
    vendorId: String((data as { vendor_id: string }).vendor_id),
    customerProfileId: null,
    completedAt: String((data as { completed_at: string | null }).completed_at ?? new Date().toISOString()),
    totalAmountKobo: Number((data as { total_amount: number }).total_amount ?? 0),
  }
}

async function loadCustomerProfileId(db: ReturnType<typeof createSupabaseAdmin>, customerId: string | null) {
  if (!customerId) return null
  const { data } = await db
    .from('social_profiles')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle()
  return data ? String((data as { id: string }).id) : null
}

async function loadCandidateData(db: ReturnType<typeof createSupabaseAdmin>, orderId: string, customerProfileId: string | null, completedAt: string, windowMinutes: number, vendorId: string) {
  const windowStart = new Date(new Date(completedAt).getTime() - windowMinutes * 60_000).toISOString()
  const { data: eventRows } = await db
    .from('feed_events')
    .select('id, post_id, viewer_profile_id, event_type, source_tab, created_at, metadata')
    .eq('viewer_profile_id', customerProfileId ?? '')
    .gte('created_at', windowStart)
    .lte('created_at', completedAt)
    .in('event_type', Array.from(ATTRIBUTION_EVENT_TYPES))

  const events = (eventRows ?? []) as FeedAttributionEvent[]
  const postIds = Array.from(new Set(events.map((event) => event.post_id).filter(Boolean) as string[]))
  if (postIds.length === 0) {
    return { events, posts: [] as FeedAttributionPost[] }
  }

  const { data: posts } = await db
    .from('posts')
    .select('id, vendor_id, author_profile_id, status, deleted_at, is_archived')
    .in('id', postIds)

  const eligiblePosts = (posts ?? [])
    .map((row) => row as FeedAttributionPost)
    .filter((post) => post.vendor_id === vendorId)
  return { events, posts: eligiblePosts }
}

async function insertLifecycleEvent(
  db: ReturnType<typeof createSupabaseAdmin>,
  orderId: string,
  kind: 'completed_order' | 'cancelled_order' | 'refunded_order',
  completedAt: string,
  customerProfileId: string | null,
  orderVendorId: string,
) {
  const eventKey = `order:${orderId}:${kind}`
  const { error } = await db.from('feed_events').insert({
    event_key: eventKey,
    viewer_profile_id: customerProfileId,
    post_id: null,
    event_type: kind,
    source_tab: null,
    currency: 'NGN',
    amount_kobo: 0,
    metadata: {
      order_id: orderId,
      vendor_id: orderVendorId,
      event_kind: kind,
      completed_at: completedAt,
    },
    rule_version: FEED_ATTRIBUTION_RULE_VERSION,
    algorithm_version: FEED_ATTRIBUTION_ALGORITHM_VERSION,
    batch_key: `order:${orderId}`,
    session_id: null,
  })
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
}

export async function finalizeOrderFeedAttribution(orderId: string) {
  const db = createSupabaseAdmin()
  const order = await loadOrderContext(db, orderId)
  if (!order || !order.completedAt) return { attributed: 0, candidates: [] as FeedAttributionCandidate[] }

  const { data: orderRow } = await db
    .from('orders')
    .select('id, vendor_id, customer_id, completed_at, total_amount, status')
    .eq('id', orderId)
    .maybeSingle()
  if (!orderRow) return { attributed: 0, candidates: [] as FeedAttributionCandidate[] }
  const customerId = String((orderRow as { customer_id: string | null }).customer_id ?? '')
  const resolvedCustomerProfileId = await loadCustomerProfileId(db, customerId)
  if (!resolvedCustomerProfileId) return { attributed: 0, candidates: [] as FeedAttributionCandidate[] }

  const rule = await loadAttributionRule(db)
  const { events, posts } = await loadCandidateData(db, orderId, resolvedCustomerProfileId, String((orderRow as { completed_at: string | null }).completed_at ?? order.completedAt), rule.windowMinutes, String((orderRow as { vendor_id: string }).vendor_id))
  const candidates = selectAttributionCandidates({
    orderId,
    orderVendorId: String((orderRow as { vendor_id: string }).vendor_id),
    customerProfileId: resolvedCustomerProfileId,
    completedAt: String((orderRow as { completed_at: string | null }).completed_at ?? order.completedAt),
    totalAmountKobo: Number((orderRow as { total_amount: number }).total_amount ?? 0),
    events,
    posts,
    windowMinutes: rule.windowMinutes,
    minimumConfidence: rule.minimumConfidence,
    maxSources: rule.maxSources,
  })

  if (candidates.length === 0) {
    await insertLifecycleEvent(db, orderId, 'completed_order', order.completedAt, resolvedCustomerProfileId, order.vendorId)
    return { attributed: 0, candidates: [] as FeedAttributionCandidate[] }
  }

  const rows = candidates.map((candidate) => ({
    order_id: candidate.orderId,
    post_id: candidate.postId,
    viewer_profile_id: candidate.viewerProfileId,
    source_event_id: candidate.sourceEventId,
    source_event_type: candidate.sourceEventType,
    event_at: candidate.eventAt,
    attributed_at: new Date().toISOString(),
    attribution_window_minutes: rule.windowMinutes,
    rule_version: rule.ruleVersion,
    algorithm_version: rule.algorithmVersion,
    confidence: candidate.confidence,
    revenue_kobo: candidate.revenueKobo,
    status: 'credited',
    reversal_reason: null,
    metadata: {
      order_id: orderId,
      vendor_id: orderRow.vendor_id,
    },
  }))

  const { error } = await db.from('feed_order_attributions').insert(rows)
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)

  await insertLifecycleEvent(db, orderId, 'completed_order', String((orderRow as { completed_at: string | null }).completed_at ?? order.completedAt), resolvedCustomerProfileId, String((orderRow as { vendor_id: string }).vendor_id))

  return { attributed: rows.length, candidates }
}

export async function reverseOrderFeedAttribution(orderId: string, status: 'cancelled_order' | 'refunded_order', reason: string) {
  const db = createSupabaseAdmin()
  const order = await loadOrderContext(db, orderId)
  if (!order) return { reversed: 0 }
  const { data: updated } = await db
    .from('feed_order_attributions')
    .update({
      status: 'reversed',
      reversal_reason: reason,
    })
    .eq('order_id', orderId)
    .neq('status', 'reversed')
    .select('id')

  const { data: orderRow } = await db.from('orders').select('customer_id, vendor_id, completed_at').eq('id', orderId).maybeSingle()
  const resolvedCustomerProfileId = await loadCustomerProfileId(db, (orderRow as { customer_id: string | null } | null)?.customer_id ?? null)
  await insertLifecycleEvent(
    db,
    orderId,
    status,
    String((orderRow as { completed_at: string | null } | null)?.completed_at ?? order.completedAt),
    resolvedCustomerProfileId,
    String((orderRow as { vendor_id: string } | null)?.vendor_id ?? order.vendorId),
  )
  return { reversed: updated?.length ?? 0 }
}

export { scoreEvent as scoreFeedAttributionEvent }
