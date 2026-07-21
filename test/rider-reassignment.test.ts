/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionPayload } from '@/lib/session'
import { ctxWithId, makeReq, session } from './helpers/kit'

const RIDER_ID = '7b6c8a12-5e0b-4f23-9a80-384d5464584b'
const ORDER_ID = '8b6c8a12-5e0b-4f23-9a80-384d5464584c'

const h = vi.hoisted(() => ({
  session: null as SessionPayload | null,
  rpcResult: [{ success: true, error_code: null, order_number: 'LXF-2026-000001', previous_rider_id: null }] as Array<{
    success: boolean
    error_code: string | null
    order_number: string | null
    previous_rider_id: string | null
  }>,
  rpcError: null as { message: string } | null,
  securityEvent: vi.fn(),
}))

vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  getCurrentUser: async () => h.session,
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    rpc: async () => ({ data: h.rpcResult, error: h.rpcError }),
    from: () => {
      const p = Promise.resolve({ data: { id: 'row-1' }, error: null })
      const proxy: any = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'then') return p.then.bind(p)
          if (prop === 'catch') return p.catch.bind(p)
          if (prop === 'finally') return p.finally.bind(p)
          if (prop === 'single' || prop === 'maybeSingle') return () => p
          return () => proxy
        },
      })
      return proxy
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: async () => ({ success: true, remaining: 99, reset: 0 }) }))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: h.securityEvent }))
vi.mock('@/lib/order-status-email', () => ({ emailCommittedOrderStatus: async () => {} }))

beforeEach(() => {
  h.session = null
  h.rpcResult = [{ success: true, error_code: null, order_number: 'LXF-2026-000001', previous_rider_id: null }]
  h.rpcError = null
  h.securityEvent.mockReset()
})

describe('admin rider reassignment', () => {
  it('locks order and rider state in the database function', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '143_admin_rider_reassignment.sql'), 'utf8')
    expect(sql).toMatch(/FUNCTION admin_reassign_order_rider/i)
    expect(sql).toMatch(/FROM orders[\s\S]*FOR UPDATE/i)
    expect(sql).toMatch(/FROM riders[\s\S]*FOR UPDATE/i)
    expect(sql).toMatch(/UPDATE riders[\s\S]*active_order_id = NULL/i)
    expect(sql).toMatch(/UPDATE orders[\s\S]*rider_id = p_new_rider_id/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION admin_reassign_order_rider/i)
  })

  it('lets admins reassign a ready order to an online rider', async () => {
    h.session = session('admin', 'adm1')
    const mod: any = await import('@/app/api/admin/orders/[id]/reassign-rider/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: `http://localhost/api/admin/orders/${ORDER_ID}/reassign-rider`,
      body: { rider_id: RIDER_ID, reason: 'Nearest rider changed after delay' },
    }), ctxWithId(ORDER_ID))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, rider_id: RIDER_ID })
    expect(h.securityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'order_rider_reassigned',
      resourceId: ORDER_ID,
    }))
  })

  it('returns operator-friendly errors from reassignment rejection codes', async () => {
    h.session = session('admin', 'adm1')
    h.rpcResult = [{ success: false, error_code: 'RIDER_BUSY', order_number: 'LXF-2026-000001', previous_rider_id: null }]
    const mod: any = await import('@/app/api/admin/orders/[id]/reassign-rider/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: `http://localhost/api/admin/orders/${ORDER_ID}/reassign-rider`,
      body: { rider_id: RIDER_ID, reason: 'Nearest rider changed after delay' },
    }), ctxWithId(ORDER_ID))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'RIDER_BUSY' })
  })
})
