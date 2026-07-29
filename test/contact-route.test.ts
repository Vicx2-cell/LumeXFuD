/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeReq, makeDb, type DbRows } from './helpers/kit'

const h = vi.hoisted(() => ({
  rows: {} as DbRows,
  delivered: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: async () => ({ success: true, remaining: 99, reset: 0 }) }))
vi.mock('@/lib/email/workflow-email', () => ({ deliverWorkflowEmail: h.delivered }))

beforeEach(() => {
  h.rows = {}
  h.delivered.mockReset()
})

describe('contact intake', () => {
  it('saves a support request and still returns a reference when email acknowledgement fails', async () => {
    h.rows = {
      contact_cases: {
        data: {
          id: 'case-1',
          reference_number: 'LXF-SUP-20260729-ABC12345',
          acknowledgement_status: 'failed',
        },
        error: null,
      },
    }
    h.delivered.mockResolvedValue({ status: 'failed' })

    const mod: any = await import('@/app/api/contact/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: 'http://localhost/api/contact',
      body: {
        intent: 'support',
        name: 'Vendor User',
        email: 'vendor@example.com',
        subject: 'Delivery issue',
        message: 'The rider never reached the gate and I need help.',
        relatedReference: 'ORD-123',
      },
    }))

    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean; duplicate: boolean; reference: string; acknowledgementStatus: string }
    expect(json).toMatchObject({
      success: true,
      duplicate: false,
      acknowledgementStatus: 'failed',
    })
    expect(json.reference).toMatch(/^LXF-SUP-20260729-/)
    expect(h.delivered).toHaveBeenCalledOnce()
  })
})
