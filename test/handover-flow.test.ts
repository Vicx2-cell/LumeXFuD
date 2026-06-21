/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionPayload } from '@/lib/session'
import { makeReq, ctxWithId, session, makeDb, PASS_RL, type DbRows } from './helpers/kit'
import { hashHandoverCode } from '@/lib/handover-code'

// Break-tests for the handover FLOW invariants (engine-level crypto is covered in
// handover-code.test.ts). These prove the route-level money/secrecy gates:
//   I2 — no valid code → no release
//   I3 — the code is never in any notification template or contact deep link
//   I7 — the pickup forfeit window is server-derived (default 85 min)
//   I8 — the binding-action consent vocabulary exists

const h = vi.hoisted(() => ({ session: null as SessionPayload | null, rows: {} as DbRows }))
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  getCurrentUser: async () => h.session,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/features', () => ({ getFeature: async () => true }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: PASS_RL }))
// Keep money/notify side-effects inert (they must NOT be reached on the failure paths).
vi.mock('@/lib/notify', () => ({ sendWhatsAppWithFallback: async () => {} }))

beforeEach(() => { h.session = null; h.rows = {} })

const CODE = 'ABC234'
const HASH = hashHandoverCode(CODE)

describe('I2 — funds never release without a valid handover code', () => {
  it('pickup collect: a WRONG code is rejected and the order is NOT completed', async () => {
    h.session = session('vendor', 'vendorA')
    h.rows = { orders: { data: {
      id: 'o1', order_number: 'LXF-1', status: 'READY', delivery_type: 'PICKUP',
      vendor_id: 'vendorA', customer_id: 'custA', handover_code_hash: HASH,
      handover_code_locked: false, payment_status: 'PAID', subtotal: 100000, platform_markup: 25000,
    }, error: null } }
    const mod: any = await import('@/app/api/orders/[id]/collect/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { code: 'ZZZ999' } }), ctxWithId('o1'))
    expect(res.status).toBe(400)
    expect((await res.json()).status).toBeUndefined() // never reports COMPLETED
  })

  it('pickup collect: a locked order refuses even the right code (force-refresh)', async () => {
    h.session = session('vendor', 'vendorA')
    h.rows = { orders: { data: {
      id: 'o1', order_number: 'LXF-1', status: 'READY', delivery_type: 'PICKUP',
      vendor_id: 'vendorA', customer_id: 'custA', handover_code_hash: HASH,
      handover_code_locked: true, payment_status: 'PAID', subtotal: 100000, platform_markup: 25000,
    }, error: null } }
    const mod: any = await import('@/app/api/orders/[id]/collect/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { code: CODE } }), ctxWithId('o1'))
    expect(res.status).toBe(423)
  })

  it('delivery: confirming with NO code is rejected and the order is NOT delivered', async () => {
    h.session = session('rider', 'riderA')
    h.rows = { orders: { data: {
      id: 'o1', order_number: 'LXF-1', status: 'PICKED_UP', delivery_type: 'BIKE',
      vendor_id: 'vendorA', rider_id: 'riderA', customer_id: 'custA', handover_code_hash: HASH,
      handover_code_locked: false, payment_status: 'PAID', leave_at_gate: false,
    }, error: null } }
    const mod: any = await import('@/app/api/orders/[id]/deliver/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: {} }), ctxWithId('o1'))
    expect(res.status).toBe(400)
  })

  it('delivery: a WRONG code is rejected and the order is NOT delivered', async () => {
    h.session = session('rider', 'riderA')
    h.rows = { orders: { data: {
      id: 'o1', order_number: 'LXF-1', status: 'PICKED_UP', delivery_type: 'BIKE',
      vendor_id: 'vendorA', rider_id: 'riderA', customer_id: 'custA', handover_code_hash: HASH,
      handover_code_locked: false, payment_status: 'PAID', leave_at_gate: false,
    }, error: null } }
    const mod: any = await import('@/app/api/orders/[id]/deliver/route')
    const res = await mod.POST(makeReq({ method: 'POST', body: { code: 'ZZZ999' } }), ctxWithId('o1'))
    expect(res.status).toBe(400)
  })
})

describe('I3 — the code never appears in any notification or contact link', () => {
  it('no message template embeds a handover/pickup code placeholder', async () => {
    const { TEMPLATES } = await import('@/lib/notify-templates')
    for (const body of Object.values(TEMPLATES)) {
      expect(body).not.toContain('pickup_code')
      expect(body).not.toContain('handover_code')
      expect(body).not.toMatch(/\{code\}/)
    }
  })

  it('contact deep links carry no code (E.164 + prefilled text only)', async () => {
    const { waLink, telLink, toE164Digits } = await import('@/lib/contact')
    expect(toE164Digits('08012345678')).toBe('2348012345678')
    expect(toE164Digits('+2348012345678')).toBe('2348012345678')
    expect(telLink('08012345678')).toBe('tel:+2348012345678')
    const link = waLink('08012345678', 'Your order LXF-1 is ready to collect.')
    expect(link.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    expect(link).not.toContain(CODE)
  })
})

describe('I7 — the pickup forfeit window is server-derived', () => {
  it('defaults to 85 minutes (1h25m) when unset, and exposes strike config', async () => {
    h.rows = {} // settings query returns nothing → defaults
    const { getPickupConfig } = await import('@/lib/pickup')
    const cfg = await getPickupConfig()
    expect(cfg.holdMinutes).toBe(85)
    expect(cfg.strikeLimit).toBe(3)
    expect(cfg.firstNoShowGoodwill).toBe(false)
  })
})

describe('I8 — binding-action consent vocabulary', () => {
  it('defines the place/handover/deliver actions used by the routes', async () => {
    const { CONSENT_ACTIONS } = await import('@/lib/consent')
    expect(CONSENT_ACTIONS.PICKUP_PLACE).toBeTruthy()
    expect(CONSENT_ACTIONS.VENDOR_HANDOVER).toBeTruthy()
    expect(CONSENT_ACTIONS.RIDER_DELIVER).toBeTruthy()
    expect(CONSENT_ACTIONS.LEAVE_AT_GATE).toBeTruthy()
  })
})
