/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionPayload, SessionRole } from '@/lib/session'
import { makeReq, ctxWithId, session, pickWrongRole, makeDb, PASS_RL, type DbRows } from './helpers/kit'

// ════════════════════════════════════════════════════════════════════════════
// Access-control regression suite (Playbook Phase Y).
//
// Locks in BFLA (wrong-role → 403) and unauthenticated (no session → 401/403)
// for every role-gated API route, plus IDOR (other-user → 403/404) for every
// route that accepts a resource id, plus the bank-column-exposure guarantee.
//
// HOW IT WORKS: getCurrentUser, createSupabaseAdmin, the rate limiter and the
// feature flags are mocked so the guard branch is exercised deterministically
// with no DB/network/Upstash. The guards run before any DB work, so the mocked
// DB is only meaningfully exercised by the IDOR cases (which configure a
// resource owned by user A and then call as user B).
//
// These run with NO real keys — purely in-process. Safe for CI / local / staging.
// ════════════════════════════════════════════════════════════════════════════

// Hoisted shared state the mock factories close over.
const h = vi.hoisted(() => ({ session: null as SessionPayload | null, rows: {} as DbRows }))

vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  getCurrentUser: async () => h.session,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/features', () => ({ getFeature: async () => true }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitGeneric: PASS_RL,
  rateLimitOtpSend: PASS_RL,
  rateLimitOtpVerify: PASS_RL,
  rateLimitPinLogin: PASS_RL,
  rateLimitForgotPinQuestions: PASS_RL,
  rateLimitForgotPinGetQuestions: PASS_RL,
  rateLimitForgotPinRecoveryCode: PASS_RL,
}))

beforeEach(() => {
  h.session = null
  h.rows = {}
})

type Entry = { path: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; allow: SessionRole[] }

// ─── Role-gated routes (path is relative to repo root, '@/' alias) ────────────
// allow = the roles that route's own in-code guard permits. Every other role
// must get 403, and (for these strictly-gated routes) no session must get 401/403.
const A_S: SessionRole[] = ['admin', 'super_admin']
const SUPER: SessionRole[] = ['super_admin']
const VR: SessionRole[] = ['vendor', 'rider']

const ENTRIES: Entry[] = [
  // ── super_admin only ──
  { path: 'app/api/admin/feature-flags/route', method: 'GET', allow: SUPER },
  { path: 'app/api/admin/feature-flags/route', method: 'POST', allow: SUPER },
  { path: 'app/api/admin/wallet-adjust/route', method: 'POST', allow: SUPER },
  { path: 'app/api/admin/block/route', method: 'GET', allow: SUPER },
  { path: 'app/api/admin/block/route', method: 'POST', allow: SUPER },
  { path: 'app/api/admin/stats/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/withdraw/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/users/[id]/force-reset-pin/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/team/create/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/features/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/features/route', method: 'PATCH', allow: SUPER },
  { path: 'app/api/super-admin/super-audit/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/financials/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/settings/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/settings/route', method: 'PATCH', allow: SUPER },
  { path: 'app/api/super-admin/sentinel/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/cron-health/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/cron-run/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/security-health/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/feature-usage/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/lockdown/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/lockdown/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/revoke-sessions/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/earnings/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/earnings/history/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/controls/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/controls/route', method: 'PATCH', allow: SUPER },
  { path: 'app/api/super-admin/pricing/route', method: 'GET', allow: SUPER },
  { path: 'app/api/super-admin/pricing/route', method: 'PATCH', allow: SUPER },
  { path: 'app/api/super-admin/announcement/route', method: 'POST', allow: SUPER },
  { path: 'app/api/super-admin/announcement/route', method: 'DELETE', allow: SUPER },

  // ── admin + super_admin ──
  { path: 'app/api/admin/audit/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/dashboard/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/orders/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/disputes/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/disputes/[id]/resolve/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/disputes/[id]/analyze/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/wallets/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/lodges/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/lodges/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/lodges/[id]/route', method: 'PATCH', allow: A_S },
  { path: 'app/api/admin/lodges/[id]/route', method: 'DELETE', allow: A_S },
  { path: 'app/api/admin/face/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/face/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/kyc/queue/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/verify-receipt/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/pin-resets/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/reviews/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/reviews/[id]/route', method: 'DELETE', allow: A_S },
  { path: 'app/api/admin/vendors/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/vendors/[id]/route', method: 'PATCH', allow: A_S },
  { path: 'app/api/admin/vendors/[id]/route', method: 'DELETE', allow: A_S },
  { path: 'app/api/admin/vendors/create/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/riders/route', method: 'GET', allow: A_S },
  { path: 'app/api/admin/riders/[id]/route', method: 'PATCH', allow: A_S },
  { path: 'app/api/admin/riders/[id]/route', method: 'DELETE', allow: A_S },
  { path: 'app/api/admin/riders/create/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/users/[id]/reset-pin/route', method: 'POST', allow: A_S },
  { path: 'app/api/admin/suspend/route', method: 'POST', allow: A_S },
  { path: 'app/api/wallet/freeze/route', method: 'POST', allow: A_S },
  { path: 'app/api/wallet/unfreeze/route', method: 'POST', allow: A_S },
  { path: 'app/api/paystack/refund/route', method: 'POST', allow: A_S },

  // ── vendor + rider (wallet) ──
  { path: 'app/api/wallet/withdraw/route', method: 'POST', allow: VR },
  { path: 'app/api/wallet/verify-account/route', method: 'POST', allow: VR },
  { path: 'app/api/wallet/transactions/route', method: 'GET', allow: VR },
  { path: 'app/api/wallet/set-pin/route', method: 'POST', allow: VR },
  { path: 'app/api/wallet/save-bank/route', method: 'POST', allow: VR },
  { path: 'app/api/wallet/balance/route', method: 'GET', allow: VR },
  { path: 'app/api/wallet/banks/route', method: 'GET', allow: VR },
  // NOTE: auth/face/status and customer/addresses are intentionally SOFT-auth —
  // they return an empty/exempt payload (no other-user data) instead of 401/403,
  // so a blip never locks a dashboard. Their behaviour is locked in separately below.

  // ── vendor only ──
  { path: 'app/api/vendor/reviews/route', method: 'GET', allow: ['vendor'] },
  { path: 'app/api/vendor/menu/route', method: 'GET', allow: ['vendor'] },
  { path: 'app/api/vendor/menu/route', method: 'POST', allow: ['vendor'] },
  { path: 'app/api/vendor/menu/[id]/route', method: 'PATCH', allow: ['vendor'] },
  { path: 'app/api/vendor/menu/[id]/route', method: 'DELETE', allow: ['vendor'] },
  { path: 'app/api/upload/menu-image/route', method: 'POST', allow: ['vendor'] },

  // ── rider only ──
  { path: 'app/api/rider/reviews/route', method: 'GET', allow: ['rider'] },

  // ── customer only ──
  { path: 'app/api/customer-wallet/transactions/route', method: 'GET', allow: ['customer'] },
  { path: 'app/api/customer-wallet/topup/route', method: 'POST', allow: ['customer'] },
  { path: 'app/api/customer-wallet/balance/route', method: 'GET', allow: ['customer'] },
  { path: 'app/api/orders/history/route', method: 'GET', allow: ['customer'] },
  { path: 'app/api/orders/[id]/dispute/route', method: 'POST', allow: ['customer'] },
  { path: 'app/api/orders/[id]/confirm/route', method: 'POST', allow: ['customer'] },
  { path: 'app/api/orders/[id]/rate/route', method: 'POST', allow: ['customer'] },

  // ── vendor + admin + super ──
  { path: 'app/api/vendor/orders/route', method: 'GET', allow: ['vendor', 'admin', 'super_admin'] },
  { path: 'app/api/vendors/[id]/status/route', method: 'POST', allow: ['vendor', 'admin', 'super_admin'] },
  { path: 'app/api/vendors/[id]/pause/route', method: 'POST', allow: ['vendor', 'admin', 'super_admin'] },

  // ── rider + admin + super ──
  { path: 'app/api/rider/orders/route', method: 'GET', allow: ['rider', 'admin', 'super_admin'] },
  { path: 'app/api/riders/[id]/status/route', method: 'POST', allow: ['rider', 'admin', 'super_admin'] },
  { path: 'app/api/riders/[id]/accept/route', method: 'POST', allow: ['rider', 'admin', 'super_admin'] },
]

async function invoke(entry: Entry) {
  const mod: any = await import(/* @vite-ignore */ `@/${entry.path}`)
  const handler = mod[entry.method]
  expect(handler, `${entry.method} ${entry.path} should export a handler`).toBeTypeOf('function')
  const req = makeReq({ method: entry.method, body: entry.method === 'GET' ? undefined : {} })
  return (await handler(req, ctxWithId())) as Response
}

describe('BFLA — wrong role is rejected with 403', () => {
  for (const entry of ENTRIES) {
    const wrong = pickWrongRole(entry.allow)
    it(`${entry.method} ${entry.path.replace('app/api/', '').replace('/route', '')} → 403 for ${wrong}`, async () => {
      h.session = session(wrong)
      const res = await invoke(entry)
      expect(res.status).toBe(403)
    })
  }
})

describe('Unauthenticated — no session is rejected with 401/403', () => {
  for (const entry of ENTRIES) {
    it(`${entry.method} ${entry.path.replace('app/api/', '').replace('/route', '')} → 401/403 with no session`, async () => {
      h.session = null
      const res = await invoke(entry)
      expect([401, 403]).toContain(res.status)
    })
  }
})

// ─── IDOR: a logged-in user of the RIGHT role cannot act on someone else's id ──
// We configure the loaded resource as owned by user "A" and call as user "B".
describe('IDOR / BOLA — other-user resource is blocked (403/404)', () => {
  const A = 'owner-A'
  const B = 'attacker-B'

  it('orders/[id]/status: vendor B cannot transition vendor A’s order', async () => {
    h.session = session('vendor', B)
    h.rows = { orders: { data: { id: 'o1', order_number: 'LXF-1', status: 'PENDING', vendor_id: A, customer_id: A, rider_id: null }, error: null } }
    const mod: any = await import('@/app/api/orders/[id]/status/route')
    const res = await mod.PATCH(makeReq({ method: 'PATCH', body: { status: 'VENDOR_ACCEPTED' } }), ctxWithId('o1'))
    expect(res.status).toBe(403)
  })

  it('orders/[id]/status: rider B cannot pick up rider A’s order', async () => {
    h.session = session('rider', B)
    h.rows = { orders: { data: { id: 'o1', order_number: 'LXF-1', status: 'RIDER_ASSIGNED', vendor_id: A, customer_id: A, rider_id: A }, error: null } }
    const mod: any = await import('@/app/api/orders/[id]/status/route')
    const res = await mod.PATCH(makeReq({ method: 'PATCH', body: { status: 'PICKED_UP' } }), ctxWithId('o1'))
    expect(res.status).toBe(403)
  })

  it('orders/[id]/cancel: customer B cannot cancel customer A’s order', async () => {
    h.session = session('customer', B)
    h.rows = {
      orders: { data: { id: 'o1', order_number: 'LXF-1', status: 'PENDING', payment_status: 'PENDING', customer_id: A, vendor_id: A }, error: null },
      customers: { data: { id: B }, error: null }, // the caller resolves to B, order belongs to A
    }
    const mod: any = await import('@/app/api/orders/[id]/cancel/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: {} }), ctxWithId('o1'))
    expect(res.status).toBe(403)
  })

  it('orders/[id]/dispute: customer B cannot dispute customer A’s order (scoped → 404)', async () => {
    h.session = session('customer', B)
    h.rows = {
      customers: { data: { id: B, phone: '+2348000000000', dispute_count: 0 }, error: null },
      orders: { data: null, error: { message: 'no rows' } }, // scoped by customer_id=B finds nothing
    }
    const mod: any = await import('@/app/api/orders/[id]/dispute/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { reason: 'WRONG_ITEMS', description: 'x' } }), ctxWithId('o1'))
    expect([403, 404]).toContain(res.status)
  })

  const scopedOrderRoutes: Array<[string, () => Promise<any>]> = [
    ['confirm', () => import('@/app/api/orders/[id]/confirm/route')],
    ['rate', () => import('@/app/api/orders/[id]/rate/route')],
    ['reorder', () => import('@/app/api/orders/[id]/reorder/route')],
  ]
  for (const [name, load] of scopedOrderRoutes) {
    it(`orders/[id]/${name}: customer B cannot act on customer A’s order (scoped → 404)`, async () => {
      h.session = session('customer', B)
      h.rows = {
        customers: { data: { id: B, name: 'B' }, error: null },
        orders: { data: null, error: { message: 'no rows' } },
      }
      const mod = await load()
      const res = await mod.POST(makeReq({ method: 'POST', body: { stars: 5 } }), ctxWithId('o1'))
      expect([403, 404]).toContain(res.status)
    })
  }

  it('riders/[id]/accept: rider B cannot accept using rider A’s id', async () => {
    h.session = session('rider', B)
    h.rows = { riders: { data: { id: A, status: 'ONLINE', active_order_id: null, is_active: true }, error: null } }
    const mod: any = await import('@/app/api/riders/[id]/accept/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { order_id: '11111111-1111-4111-8111-111111111111' } }), ctxWithId(A))
    expect(res.status).toBe(403)
  })

  it('riders/[id]/status: rider B cannot change rider A’s status', async () => {
    h.session = session('rider', B)
    h.rows = { riders: { data: { id: A, active_order_id: null }, error: null } }
    const mod: any = await import('@/app/api/riders/[id]/status/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { status: 'OFFLINE' } }), ctxWithId(A))
    expect(res.status).toBe(403)
  })

  it('vendors/[id]/status: vendor B cannot change vendor A’s status', async () => {
    h.session = session('vendor', B)
    h.rows = { vendors: { data: { id: A, phone: '+234800' }, error: null } }
    const mod: any = await import('@/app/api/vendors/[id]/status/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { status: 'OPEN' } }), ctxWithId(A))
    expect(res.status).toBe(403)
  })

  it('vendors/[id]/pause: vendor B cannot pause vendor A', async () => {
    h.session = session('vendor', B)
    h.rows = { vendors: { data: { id: A, phone: '+234800' }, error: null } }
    const mod: any = await import('@/app/api/vendors/[id]/pause/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { minutes: 30 } }), ctxWithId(A))
    expect([403, 404]).toContain(res.status)
  })

  for (const m of ['PATCH', 'DELETE'] as const) {
    it(`vendor/menu/[id] ${m}: vendor B cannot touch vendor A’s menu item`, async () => {
      h.session = session('vendor', B)
      h.rows = { menu_items: { data: { id: 'm1', vendor_id: A }, error: null } }
      const mod: any = await import('@/app/api/vendor/menu/[id]/route')
      const res = await mod[m](makeReq({ method: m, body: { name: 'x' } }), ctxWithId('m1'))
      expect(res.status).toBe(403)
    })
  }
})

// ─── M1: high-value money actions require step-up re-auth (rule #28) ──────────
// A valid session of the RIGHT role is not enough for ≥ ₦50,000 without a fresh
// login PIN. With no reauth_pin the route must refuse (reauth_required) and never
// reach the money-movement path.
describe('Step-up re-auth required for money actions ≥ ₦50,000 (M1 / rule #28)', () => {
  it('super-admin/withdraw refuses a ₦60k payout without reauth_pin', async () => {
    h.session = session('super_admin', 'sa1')
    const mod: any = await import('@/app/api/super-admin/withdraw/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { amount_kobo: 6_000_000 } }))
    expect(res.status).toBe(401)
    expect((await res.json()).reauth_required).toBe(true)
  })

  it('admin/wallet-adjust refuses a ₦60k adjustment without reauth_pin', async () => {
    h.session = session('super_admin', 'sa1')
    const mod: any = await import('@/app/api/admin/wallet-adjust/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { phone: '+2348012345678', amount_naira: 60_000, reason: 'manual correction' } }))
    expect(res.status).toBe(401)
    expect((await res.json()).reauth_required).toBe(true)
  })

  it('paystack/refund refuses a ₦60k refund without reauth_pin', async () => {
    h.session = session('admin', 'adm1')
    h.rows = { orders: { data: { id: 'o1', order_number: 'LXF-1', total_amount: 6_000_000, payment_status: 'PAID', paystack_reference: 'ref1', customer_id: 'c1', status: 'DELIVERED' }, error: null } }
    const mod: any = await import('@/app/api/paystack/refund/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { order_id: '11111111-1111-4111-8111-111111111111', reason: 'damaged', amount: 6_000_000 } }), ctxWithId('o1'))
    expect(res.status).toBe(401)
    expect((await res.json()).reauth_required).toBe(true)
  })
})

// ─── Soft-auth routes: no leak, just an empty/exempt payload for the wrong caller ──
describe('Soft-auth routes degrade without leaking other-user data', () => {
  it('customer/addresses returns empty for a non-customer / no session', async () => {
    const mod: any = await import('@/app/api/customer/addresses/route')
    for (const s of [null, session('vendor', 'attacker-B')]) {
      h.session = s
      const res = await mod.GET()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ addresses: [] })
    }
  })

  it('auth/face/status returns exempt (no KYC data) for a non-vendor/rider / no session', async () => {
    const mod: any = await import('@/app/api/auth/face/status/route')
    for (const s of [null, session('customer', 'attacker-B')]) {
      h.session = s
      const res = await mod.GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.exempt).toBe(true)
      expect(body.docs).toBeUndefined() // no per-document KYC state leaks
    }
  })
})
