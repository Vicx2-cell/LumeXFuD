/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { makeReq, makeDb, type DbRows } from './helpers/kit'

const h = vi.hoisted(() => ({
  rows: {} as DbRows,
  redisPing: vi.fn(async () => 'PONG'),
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async ping() {
      return h.redisPing()
    }
  },
}))

beforeEach(() => {
  h.rows = {}
  h.redisPing.mockClear()
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token'
})

describe('/api/health', () => {
  it('returns public shallow liveness without provider checks', async () => {
    const mod: any = await import('@/app/api/health/route')
    const res = await mod.GET(makeReq({ method: 'GET', url: 'http://localhost/api/health' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.checks).toEqual({ app: { ok: true } })
  })

  it('requires the cron secret for deep readiness', async () => {
    const mod: any = await import('@/app/api/health/route')
    const res = await mod.GET(makeReq({ method: 'GET', url: 'http://localhost/api/health?deep=1' }))
    expect(res.status).toBe(401)
  })

  it('checks Supabase and Redis in deep readiness', async () => {
    h.rows = { settings: { data: [{ id: 'platform_hours' }], error: null } }
    const mod: any = await import('@/app/api/health/route')
    const res = await mod.GET(makeReq({
      method: 'GET',
      url: 'http://localhost/api/health?deep=1',
      headers: { authorization: 'Bearer test-cron-secret' },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.checks.supabase.ok).toBe(true)
    expect(json.checks.redis.ok).toBe(true)
  })
})
