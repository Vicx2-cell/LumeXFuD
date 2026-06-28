/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #2 — RED #1: a revoked token must be bounced at the EDGE,
// not just inside getCurrentUser. This test makes that exploit fail.
//
// verifySessionToken (signature ok) and isSessionLive (DB revocation) are mocked
// so we drive the edge gate deterministically with no DB.
// ════════════════════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({ live: true }))

vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  verifySessionToken: async () => ({ sessionId: 'sess-1', userId: 'u1', phone: '+2348000000000', role: 'super_admin' as const }),
  isSessionLive: async () => h.live,
}))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: async () => {} }))
// Only hasPinResetPending touches the DB on the live path; return no pending row.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}))

import { proxy } from '@/proxy'

function req(path: string): NextRequest {
  return new NextRequest('http://localhost' + path, { headers: { cookie: 'session=faketoken' } })
}

beforeEach(() => { h.live = true })

describe('edge session revocation (proxy)', () => {
  it('REVOKED session → 307 redirect to /auth and the cookie is cleared', async () => {
    h.live = false
    const res = await proxy(req('/super-admin'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/auth')
    const setCookie = (res.headers.get('set-cookie') ?? '').toLowerCase()
    expect(setCookie).toContain('session=')        // delete writes an expiring cookie
    expect(setCookie).toMatch(/max-age=0|expires=/) // proof it's a clear, not a set
  })

  it('LIVE session → allowed through (not redirected to /auth)', async () => {
    h.live = true
    const res = await proxy(req('/super-admin'))
    expect(res.headers.get('location') ?? '').not.toContain('/auth')
  })

  it('FAIL CLOSED: isSessionLive false (e.g. DB error) is treated as dead', async () => {
    h.live = false // isSessionLive returns false on any DB error/timeout by contract
    const res = await proxy(req('/admin'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/auth')
  })
})
