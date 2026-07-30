import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const state = vi.hoisted(() => ({
  session: { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' },
  replaySpy: vi.fn(async () => undefined),
  auditSpy: vi.fn(async () => undefined),
}))

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: vi.fn(async () => ({ success: true, remaining: 99, reset: 0 })) }))
vi.mock('@/lib/audit', () => ({ superAudit: state.auditSpy }))
vi.mock('@/lib/paystack/webhook', () => ({ processWebhookAsync: state.replaySpy }))

describe('super-admin paystack replay route', () => {
  beforeEach(() => {
    state.session = { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' }
    state.replaySpy.mockReset()
    state.auditSpy.mockReset()
  })

  it('requires explicit confirmation and replays the webhook payload', async () => {
    const res = (await POST(new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        payload: { event: 'refund.processed', data: { transaction_reference: 'order-ref-1' } },
        reason: 'Reprocess after fixing the ledger claim',
        idempotency_key: 'replay-1',
        confirm: true,
      }),
    }) as never))!

    expect(res.status).toBe(200)
    expect(state.replaySpy).toHaveBeenCalledTimes(1)
    const call = (state.replaySpy.mock.calls as unknown as Array<[unknown]>)[0]
    expect(call[0]).toMatchObject({
      event: 'refund.processed',
      data: { transaction_reference: 'order-ref-1' },
    })
    expect(state.auditSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects missing confirmation', async () => {
    const res = (await POST(new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        payload: { event: 'refund.processed', data: { transaction_reference: 'order-ref-1' } },
        reason: 'No confirm',
        idempotency_key: 'replay-1',
      }),
    }) as never))!

    expect(res.status).toBe(400)
    expect(state.replaySpy).not.toHaveBeenCalled()
  })
})
