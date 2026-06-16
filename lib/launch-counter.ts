import { Redis } from '@upstash/redis'
import { createSupabaseAdmin } from './supabase/server'

// "Launch Counter" data layer. The flag + its config live in the feature_flags
// table (migration 054); the live student count is cached in Upstash for 60s so
// the public endpoint serves a cheap integer instead of a COUNT(*) per request.

export const LAUNCH_COUNTER_KEY = 'launch_counter'
const COUNT_CACHE_KEY = 'launch_counter:count'
const COUNT_TTL_SECONDS = 60
const DEFAULT_GOAL = 500

export interface LaunchFlag {
  enabled: boolean
  goal: number
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

/** Pull the goal out of the flag's JSONB config, defensively. */
export function parseGoal(config: unknown): number {
  if (config && typeof config === 'object' && 'goal' in config) {
    const g = (config as { goal: unknown }).goal
    if (typeof g === 'number' && Number.isFinite(g) && g > 0) return Math.floor(g)
  }
  return DEFAULT_GOAL
}

/** Read the launch_counter flag (enabled + goal). Service role; never client. */
export async function getLaunchFlag(): Promise<LaunchFlag> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('feature_flags')
    .select('enabled, config')
    .eq('key', LAUNCH_COUNTER_KEY)
    .maybeSingle()
  return { enabled: Boolean(data?.enabled), goal: parseGoal(data?.config) }
}

/**
 * Total non-deleted customers ("students onboard"), cached 60s in Upstash.
 * Serves from cache when warm; only counts in the DB on a miss.
 */
export async function getCustomerCount(): Promise<number> {
  const redis = getRedis()

  if (redis) {
    try {
      const cached = await redis.get<number>(COUNT_CACHE_KEY)
      if (typeof cached === 'number') return cached
    } catch {
      // cache unreachable — fall through to the DB
    }
  }

  const db = createSupabaseAdmin()
  const { count } = await db
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
  const total = count ?? 0

  if (redis) {
    try {
      await redis.set(COUNT_CACHE_KEY, total, { ex: COUNT_TTL_SECONDS })
    } catch {
      // cache write failure is non-fatal
    }
  }
  return total
}

/** Drop the cached count so the next read recomputes (used after a flag change). */
export async function invalidateCustomerCountCache(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(COUNT_CACHE_KEY)
  } catch {
    // non-fatal
  }
}
