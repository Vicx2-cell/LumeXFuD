import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisStore = new Map<string, unknown>()
const redisCalls: Array<{ key: string; value: unknown; ex?: number }> = []

vi.mock('@upstash/redis', () => ({
  Redis: class {
    async get(key: string) {
      return redisStore.get(key) ?? null
    }
    async set(key: string, value: unknown, options?: { ex?: number }) {
      redisStore.set(key, value)
      redisCalls.push({ key, value, ex: options?.ex })
    }
    async del(key: string) {
      redisStore.delete(key)
    }
  },
}))

describe('Lumi conversation state', () => {
  beforeEach(() => {
    redisStore.clear()
    redisCalls.length = 0
    vi.resetModules()
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
  })

  it('stores state with a 10-minute TTL', async () => {
    const { setState, getState } = await import('@/lib/lumi/state')
    await setState('user-1', {
      version: 1,
      step: 'awaiting_funding_amount',
      activeIntent: 'fund_wallet',
      updatedAt: new Date().toISOString(),
    })

    expect(redisCalls.at(-1)?.key).toBe('lumi:conversation:user-1')
    expect(redisCalls.at(-1)?.ex).toBe(600)

    const state = await getState('user-1')
    expect(state?.step).toBe('awaiting_funding_amount')
  })

  it('recovers safely from malformed Redis JSON', async () => {
    const { getState } = await import('@/lib/lumi/state')
    redisStore.set('lumi:conversation:user-2', '{"bad": true')
    await expect(getState('user-2')).resolves.toBeNull()
  })

  it('rejects outdated or invalid state payloads', async () => {
    const { getState } = await import('@/lib/lumi/state')
    redisStore.set('lumi:conversation:user-3', {
      version: 9,
      step: 'anything',
      updatedAt: new Date().toISOString(),
    })
    await expect(getState('user-3')).resolves.toBeNull()
  })
})
