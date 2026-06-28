/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #4 — webhook route: fail-closed dedup + forged-signature DETECT.
// HMAC, DB and the async processor are mocked so the ROUTE's control flow is
// driven deterministically. The key proof is the FAIL-OPEN-PATH-CLOSED test:
// when the dedup key can't be recorded, the money processor must NOT run.
// ════════════════════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  sigOk: true,
  insertError: null as null | { code: string; message: string },
  processSpy: vi.fn(async (_p?: any) => {}),
  recordSpy: vi.fn(async (_e?: any) => {}),
}))

vi.mock('@/lib/security', () => ({ verifyHMAC: () => h.sigOk }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({ from: () => ({ insert: async () => ({ error: h.insertError }) }) }),
}))
vi.mock('@/lib/paystack/webhook', () => ({ processWebhookAsync: h.processSpy }))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: h.recordSpy }))

import { POST } from '@/app/api/paystack/webhook/route'

function webhookReq(body: unknown = { event: 'charge.success', data: { id: 'evt_1' } }): NextRequest {
  return new NextRequest('http://localhost/api/paystack/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': 'sig', 'x-forwarded-for': '5.6.7.8' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  // A secret must be present or candidateSecrets is empty and the route 400s
  // before ever calling the (mocked) verifyHMAC.
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
  h.sigOk = true; h.insertError = null
  h.processSpy.mockClear(); h.recordSpy.mockClear()
})

describe('webhook route — signature + fail-closed dedup', () => {
  it('FORGED signature → 400, processor NOT run, and a critical webhook_reject emitted', async () => {
    h.sigOk = false
    const res = await POST(webhookReq())
    expect(res.status).toBe(400)
    expect(h.processSpy).not.toHaveBeenCalled()
    expect(h.recordSpy).toHaveBeenCalledTimes(1)
    const ev = h.recordSpy.mock.calls[0][0] as any
    expect(ev.eventType).toBe('webhook_reject')
    expect(ev.severity).toBe('critical')
    expect(ev.detail.reason).toBe('bad_signature')
  })

  it('FAIL-OPEN PATH CLOSED: non-23505 dedup insert error → processor does NOT run (root-cause fix)', async () => {
    h.insertError = { code: '23502', message: 'not-null' } // anything but 23505
    const res = await POST(webhookReq())
    expect(res.status).toBe(200)               // 200 so Paystack retries
    expect(h.processSpy).not.toHaveBeenCalled() // the bug: it used to run here
    const ev = h.recordSpy.mock.calls[0][0] as any
    expect(ev.eventType).toBe('webhook_reject')
    expect(ev.detail.reason).toBe('dedup_record_failed')
  })

  it('REPLAY (23505 already recorded) → 200, processor NOT run', async () => {
    h.insertError = { code: '23505', message: 'duplicate' }
    const res = await POST(webhookReq())
    expect(res.status).toBe(200)
    expect(h.processSpy).not.toHaveBeenCalled()
  })

  it('FIRST delivery (dedup recorded) → 200 and the processor runs exactly once', async () => {
    h.insertError = null
    const res = await POST(webhookReq())
    expect(res.status).toBe(200)
    expect(h.processSpy).toHaveBeenCalledTimes(1)
  })
})
