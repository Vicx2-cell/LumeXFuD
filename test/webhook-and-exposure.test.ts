/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeReq, makeDb, type DbRows } from './helpers/kit'

// ════════════════════════════════════════════════════════════════════════════
// Paystack webhook integrity (Playbook Phase D / Y):
//   1. a forged HMAC is rejected (no side effects),
//   2. the same reference cannot be processed twice (idempotency),
// plus the bank-column exposure guarantee (Phase B/H): public vendor routes
// must never SELECT bank/subaccount columns.
// ════════════════════════════════════════════════════════════════════════════

const WEBHOOK_SECRET = 'test-webhook-secret'

const h = vi.hoisted(() => ({ rows: {} as DbRows }))
const processSpy = vi.hoisted(() => ({ fn: vi.fn(async () => {}) }))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/paystack/webhook', () => ({ processWebhookAsync: processSpy.fn }))

function sign(rawBody: string): string {
  return crypto.createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex')
}

function webhookReq(payload: unknown, signature: string) {
  // makeReq JSON.stringifies the body; sign the IDENTICAL serialization.
  return makeReq({ method: 'POST', url: 'http://localhost/api/paystack/webhook', body: payload, headers: { 'x-paystack-signature': signature } })
}

describe('Paystack webhook — HMAC + idempotency', () => {
  beforeEach(() => {
    process.env.PAYSTACK_WEBHOOK_SECRET = WEBHOOK_SECRET
    h.rows = {}
    processSpy.fn.mockClear()
  })

  const payload = { event: 'charge.success', data: { id: 12345, reference: 'LXF-TEST-1', amount: 100000 } }

  it('rejects a forged signature with 400 and never processes', async () => {
    const mod: any = await import('@/app/api/paystack/webhook/route')
    const res = await mod.POST(webhookReq(payload, 'deadbeefdeadbeef'))
    expect(res.status).toBe(400)
    expect(processSpy.fn).not.toHaveBeenCalled()
  })

  it('accepts a valid signature once and processes it', async () => {
    h.rows = { processed_webhooks: { data: { id: 'w1' }, error: null } } // insert succeeds
    const raw = JSON.stringify(payload)
    const mod: any = await import('@/app/api/paystack/webhook/route')
    const res = await mod.POST(webhookReq(payload, sign(raw)))
    expect(res.status).toBe(200)
    expect(processSpy.fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT process a duplicate reference (unique-violation → 200, no side effect)', async () => {
    // supabase-js returns {error:{code:'23505'}} on the unique constraint — it does
    // not throw. The route must detect this and skip processing.
    h.rows = { processed_webhooks: { data: null, error: { code: '23505', message: 'duplicate key' } } }
    const raw = JSON.stringify(payload)
    const mod: any = await import('@/app/api/paystack/webhook/route')
    const res = await mod.POST(webhookReq(payload, sign(raw)))
    expect(res.status).toBe(200)
    expect(processSpy.fn).not.toHaveBeenCalled()
  })
})

// ─── Bank-column exposure: public vendor routes must not SELECT bank fields ────
const BANK_TOKENS = ['bank_account_number', 'bank_code', 'bank_account_name', 'paystack_subaccount', 'subaccount_code']

function readRoute(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
}

describe('Bank columns never exposed to non-owners', () => {
  // These routes serve vendor data to ANY authenticated user (or the public),
  // so their SELECTs must not reference any bank/subaccount column.
  for (const rel of ['app/api/vendors/[id]/route.ts', 'app/api/vendors/route.ts']) {
    it(`${rel} does not select bank columns`, () => {
      const src = readRoute(rel)
      for (const token of BANK_TOKENS) {
        expect(src, `${rel} unexpectedly references ${token}`).not.toContain(token)
      }
    })
  }
})
