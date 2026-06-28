/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionPayload } from '@/lib/session'

const spy = vi.hoisted(() => ({ record: vi.fn(async (_e?: any) => {}) }))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: spy.record }))

import { requireRole, canActOnVendor, canActOnRider, canActOnCustomer } from '@/lib/authz'

const sess = (role: SessionPayload['role'], userId = 'u1'): SessionPayload =>
  ({ sessionId: 's', userId, phone: '+2348000000000', role })

beforeEach(() => spy.record.mockClear())

describe('requireRole — function-level gate + authz_deny emission', () => {
  it('no session → 401, no event', async () => {
    const r = await requireRole(null, ['admin'], 'admin/test')
    expect(r).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
    expect(spy.record).not.toHaveBeenCalled()
  })

  it('wrong role → 403 AND emits an authz_deny event', async () => {
    const r = await requireRole(sess('customer'), ['admin', 'super_admin'], 'admin/test')
    expect(r.ok).toBe(false)
    expect((r as any).status).toBe(403)
    expect(spy.record).toHaveBeenCalledTimes(1)
    const ev = spy.record.mock.calls[0][0] as any
    expect(ev.eventType).toBe('authz_deny')
    expect(ev.actorRole).toBe('customer')
    expect(ev.detail.needed).toEqual(['admin', 'super_admin'])
  })

  it('right role → ok, no event', async () => {
    const r = await requireRole(sess('super_admin'), ['admin', 'super_admin'], 'admin/test')
    expect(r.ok).toBe(true)
    expect((r as any).session.role).toBe('super_admin')
    expect(spy.record).not.toHaveBeenCalled()
  })
})

describe('object-level ownership helpers (staff bypass, else must own)', () => {
  it('canActOnVendor', () => {
    expect(canActOnVendor(sess('vendor', 'v1'), 'v1')).toBe(true)
    expect(canActOnVendor(sess('vendor', 'v2'), 'v1')).toBe(false)
    expect(canActOnVendor(sess('admin'), 'v1')).toBe(true)
    expect(canActOnVendor(sess('super_admin'), 'v1')).toBe(true)
    expect(canActOnVendor(sess('rider', 'v1'), 'v1')).toBe(false)
  })
  it('canActOnRider / canActOnCustomer', () => {
    expect(canActOnRider(sess('rider', 'r1'), 'r1')).toBe(true)
    expect(canActOnRider(sess('rider', 'r2'), 'r1')).toBe(false)
    expect(canActOnCustomer(sess('customer', 'c1'), 'c1')).toBe(true)
    expect(canActOnCustomer(sess('customer', 'c2'), 'c1')).toBe(false)
    expect(canActOnCustomer(sess('admin'), 'c1')).toBe(true)
  })
})
