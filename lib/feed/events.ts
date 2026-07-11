import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { feedEventBatchInput } from './validators'
import { ensureSocialProfileForSession } from './service'

export const FEED_EVENT_RULE_VERSION = '2026-07-10.feed.attr.rule.v1'
export const FEED_EVENT_ALGORITHM_VERSION = '2026-07-10.feed.attr.v1'
export const FEED_EVENT_BATCH_LIMIT = 50

export type FeedEventInput = {
  event_key: string
  post_id?: string
  viewer_profile_id?: string
  event_type: string
  source_tab?: string
  amount_kobo?: number
  metadata?: Record<string, unknown>
}

export type FeedEventBatchInput = {
  batch_key: string
  source_tab?: string
  events: FeedEventInput[]
}

const IMPRESSION_EVENTS = new Set(['impression', 'qualified_impression'])

function normalizeEventKey(profileId: string, batchKey: string, eventKey: string) {
  return `${profileId}:${batchKey}:${eventKey}`
}

function normalizeBatchKey(batchKey: string) {
  return batchKey.trim().slice(0, 120)
}

function normalizeEvent(input: FeedEventInput & { source_tab?: string }, profileId: string, batchKey: string) {
  const eventKey = normalizeEventKey(profileId, batchKey, input.event_key)
  const sourceTab = input.source_tab ?? undefined
  const metadata = input.metadata ?? {}
  return {
    event_key: eventKey,
    viewer_profile_id: profileId,
    post_id: input.post_id ?? null,
    event_type: input.event_type,
    source_tab: sourceTab ?? null,
    currency: 'NGN',
    amount_kobo: input.amount_kobo ?? 0,
    metadata: {
      ...metadata,
      source_event_key: input.event_key,
      batch_key: batchKey,
      source_tab: sourceTab ?? null,
    },
    rule_version: FEED_EVENT_RULE_VERSION,
    algorithm_version: FEED_EVENT_ALGORITHM_VERSION,
    batch_key: batchKey,
    session_id: typeof metadata.session_id === 'string' ? metadata.session_id : null,
  }
}

async function loadExistingKeys(
  db: ReturnType<typeof createSupabaseAdmin>,
  table: 'feed_events' | 'feed_impressions',
  column: 'event_key' | 'impression_key',
  keys: string[],
) {
  if (keys.length === 0) return new Set<string>()
  const { data } = await db.from(table).select(column).in(column, keys)
  return new Set((data ?? []).map((row) => String((row as Record<string, unknown>)[column])))
}

export async function recordFeedEventBatch(input: unknown, sessionId?: string) {
  const parsed = feedEventBatchInput.safeParse(input)
  if (!parsed.success) {
    throw new Error('Invalid feed event batch')
  }

  const profile = await ensureSocialProfileForSession()
  if (!profile?.id) throw new Error('Could not resolve social profile')

  const rl = await rateLimitGeneric(`feed:events:${profile.id}`, 120, 60)
  if (!rl.success) throw new Error('Too many feed events. Please slow down.')

  const db = createSupabaseAdmin()
  const batchKey = normalizeBatchKey(parsed.data.batch_key)
  const batchInsert = await db.from('feed_event_batches').insert({
    batch_key: batchKey,
    viewer_profile_id: profile.id,
    source_tab: parsed.data.source_tab ?? null,
    event_count: parsed.data.events.length,
    deduped_count: 0,
    rule_version: FEED_EVENT_RULE_VERSION,
    algorithm_version: FEED_EVENT_ALGORITHM_VERSION,
    metadata: { session_id: sessionId ?? null },
  })
  if (batchInsert.error) {
    if (/duplicate key/i.test(batchInsert.error.message)) {
      return { batchKey, inserted: 0, deduped: parsed.data.events.length, impressions: 0 }
    }
    throw new Error(batchInsert.error.message)
  }

  const normalized = parsed.data.events.map((event) => {
    const sourceTab = event.source_tab ?? parsed.data.source_tab
    return normalizeEvent({ ...event, source_tab: sourceTab }, profile.id, batchKey)
  })

  const eventKeys = normalized.map((event) => event.event_key)
  const impressionKeys = normalized.filter((event) => IMPRESSION_EVENTS.has(event.event_type)).map((event) => event.event_key)
  const [existingEvents, existingImpressions] = await Promise.all([
    loadExistingKeys(db, 'feed_events', 'event_key', eventKeys),
    loadExistingKeys(db, 'feed_impressions', 'impression_key', impressionKeys),
  ])

  const eventRows = normalized.filter((event) => !existingEvents.has(event.event_key))
  const impressionRows = normalized.filter((event) => IMPRESSION_EVENTS.has(event.event_type) && !existingImpressions.has(event.event_key))

  if (eventRows.length > 0) {
    const { error } = await db.from('feed_events').insert(eventRows)
    if (error) throw new Error(error.message)
  }

  if (impressionRows.length > 0) {
    const { error } = await db.from('feed_impressions').insert(
      impressionRows.map((event) => {
        const metadata = event.metadata as Record<string, unknown>
        return {
          impression_key: event.event_key,
          viewer_profile_id: event.viewer_profile_id,
          post_id: event.post_id,
          impression_type: event.event_type,
          source_tab: event.source_tab,
          dwell_ms: typeof metadata.dwell_ms === 'number' ? metadata.dwell_ms : 0,
          watched_ms: typeof metadata.watched_ms === 'number' ? metadata.watched_ms : 0,
          batch_key: event.batch_key,
          rule_version: event.rule_version,
          algorithm_version: event.algorithm_version,
        }
      }),
    )
    if (error) throw new Error(error.message)
  }

  await db
    .from('feed_event_batches')
    .update({ deduped_count: parsed.data.events.length - eventRows.length })
    .eq('batch_key', batchKey)

  return {
    batchKey,
    inserted: eventRows.length,
    deduped: parsed.data.events.length - eventRows.length,
    impressions: impressionRows.length,
  }
}

export function buildFeedEventBatchKey(profileId: string, scope: string, counter: number) {
  return `${profileId}:${scope}:${counter}`
}

export function buildFeedEventKey(profileId: string, batchKey: string, sourceKey: string) {
  return normalizeEventKey(profileId, batchKey, sourceKey)
}
