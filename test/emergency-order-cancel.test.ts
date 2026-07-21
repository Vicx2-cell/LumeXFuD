/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { SessionPayload } from '@/lib/session'
import { ctxWithId, makeReq, makeDb, session, type DbRows } from './helpers/kit'

const h = vi.hoisted(() => ({
  session: null as SessionPayload | null,
  rows: {} as DbRows,
  refund: vi.fn(),
  securityEvent: vi.fn(),
}))

vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  getCurrentUser: async () => h.session,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: async () => ({ success: true, remaining: 99, reset: 0 }) }))
vi.mock('@/lib/step-up', () => ({
  requireStepUpForAmount: async (_session: unknown, amount: number, pin: unknown) =>
    amount >= 5_000_000 && !pin ? { ok: false, status: 401, error: 'Re-auth required' } : { ok: true },
}))
vi.mock('@/lib/order-refund', () => ({
  refundOrderPayments: h.refund,
}))
vi.mock('@/lib/security-events', () => ({
  recordSecurityEvent: h.securityEvent,
}))
vi.mock('@/lib/notify', () => ({
  sendWhatsAppWithFallback: async () => {},
}))
vi.mock('@/lib/notify-templates', () => ({
  renderTemplate: () => 'cancelled',
}))
vi.mock('@/lib/order-status-email', () => ({
  emailCommittedOrderStatus: async () => {},
}))
vi.mock('@/lib/feed/attribution', () => ({
  reverseOrderFeedAttribution: async () => {},
}))

beforeEach(() => {
  h.session = null
  h.rows = {}
  h.refund.mockReset()
  h.refund.mockResolvedValue({ walletOk: true, paystackOk: true, walletPortion: 0, paystackPortion: 6_000_000 })
  h.securityEvent.mockReset()
})

describe('admin emergency order cancellation', () => {
  it('requires step-up before cancelling and refunding high-value paid orders', async () => {
    h.session = session('admin', 'adm1')
    h.rows = {
      orders: {
        data: {
          id: 'order-1',
          order_number: 'LXF-2026-000001',
          status: 'PICKED_UP',
          payment_status: 'PAID',
          paystack_reference: 'ps-ref',
          customer_id: 'cust-1',
          guest_phone: null,
          vendor_id: 'vendor-1',
          rider_id: 'rider-1',
          total_amount: 6_000_000,
          wallet_amount_kobo: 0,
        },
        error: null,
      },
    }

    const mod: any = await import('@/app/api/admin/orders/[id]/emergency-cancel/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: 'http://localhost/api/admin/orders/order-1/emergency-cancel',
      body: { reason: 'Campus shutdown during active delivery' },
    }), ctxWithId('order-1'))

    expect(res.status).toBe(401)
    expect((await res.json()).reauth_required).toBe(true)
    expect(h.refund).not.toHaveBeenCalled()
  })

  it('cancels, refunds, audits, and releases rider when step-up is present', async () => {
    h.session = session('super_admin', 'sa1')
    h.rows = {
      orders: {
        data: {
          id: 'order-1',
          order_number: 'LXF-2026-000001',
          status: 'PICKED_UP',
          payment_status: 'PAID',
          paystack_reference: 'ps-ref',
          customer_id: 'cust-1',
          guest_phone: '+2348012345678',
          vendor_id: 'vendor-1',
          rider_id: 'rider-1',
          total_amount: 6_000_000,
          wallet_amount_kobo: 0,
        },
        error: null,
      },
      riders: { data: { id: 'rider-1' }, error: null },
      support_notes: { data: { id: 'note-1' }, error: null },
      audit_logs: { data: { id: 'audit-1' }, error: null },
    }

    const mod: any = await import('@/app/api/admin/orders/[id]/emergency-cancel/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: 'http://localhost/api/admin/orders/order-1/emergency-cancel',
      body: { reason: 'Campus shutdown during active delivery', reauth_pin: '123456' },
    }), ctxWithId('order-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, refunded: true, rider_released: true })
    expect(h.refund).toHaveBeenCalledOnce()
    expect(h.securityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'emergency_order_cancelled',
      resourceId: 'order-1',
    }))
  })
})
