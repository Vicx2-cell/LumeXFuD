import { Redis } from '@upstash/redis'

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN
if (!url || !token) {
  // In dev, it's acceptable to allow missing Redis but production should have it
  // Throwing would break builds that import this file server-side; instead export a noop client.
}

const redis = url && token ? new Redis({ url, token }) : null

const TTL_SECONDS = 60 * 10 // 10 minutes

export type LumiState = {
  step?: string
  partial?: Record<string, any>
  updatedAt?: number
}

export async function getState(userId: string): Promise<LumiState | null> {
  if (!redis) return null
  const v = await redis.get(`lumi:state:${userId}`)
  return v ? JSON.parse(v as string) : null
}

export async function setState(userId: string, state: LumiState) {
  if (!redis) return
  state.updatedAt = Date.now()
  await redis.set(`lumi:state:${userId}`, JSON.stringify(state), { ex: TTL_SECONDS })
}

export async function clearState(userId: string) {
  if (!redis) return
  await redis.del(`lumi:state:${userId}`)
}
