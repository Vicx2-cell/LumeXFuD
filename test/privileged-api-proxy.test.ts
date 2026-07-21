import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionPayload } from '@/lib/session'

const h = vi.hoisted(() => ({
  session: null as SessionPayload | null,
  live: true,
  stored: { ip_address: '198.51.100.1', user_agent: 'Browser A' } as { ip_address: string | null; user_agent: string | null },
  event: vi.fn(async () => null),
}))

vi.mock('@/lib/session', async (original) => ({
  ...(await original<typeof import('@/lib/session')>()),
  verifySessionToken: async () => h.session,
  isSessionLive: async () => h.live,
}))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: h.event }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.stored }) }) }) }),
  }),
}))

import { proxy } from '@/proxy'

const session = (role: SessionPayload['role']): SessionPayload => ({
  sessionId: 'session-1', userId: `${role}-1`, phone: '+2348000000000', role,
})
const req = (path: string, ip = '198.51.100.1', ua = 'Browser A') => new NextRequest(`http://localhost${path}`, {
  headers: { cookie: 'session=fake', 'x-forwarded-for': ip, 'user-agent': ua },
})

beforeEach(() => {
  h.session = session('super_admin')
  h.live = true
  h.stored = { ip_address: '198.51.100.1', user_agent: 'Browser A' }
  h.event.mockClear()
})

describe('privileged API proxy evidence', () => {
  it('records anonymous privileged probes without revealing route policy', async () => {
    const res = await proxy(new NextRequest('http://localhost/api/admin/vendors'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(h.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'authz_deny', outcome: 'missing_session',
    }))
  })

  it('returns JSON 403 and evidence for a wrong-role probe', async () => {
    h.session = session('customer')
    const res = await proxy(req('/api/admin/vendors'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(h.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'suspicious_admin_access', outcome: 'wrong_role',
      requestId: expect.any(String), route: '/api/admin/vendors',
    }))
  })

  it('keeps super-only admin aliases super-only', async () => {
    h.session = session('admin')
    const res = await proxy(req('/api/admin/stats'))
    expect(res.status).toBe(403)
  })

  it('allows an authorized admin but observes changed indicators only', async () => {
    h.session = session('admin')
    const res = await proxy(req('/api/admin/vendors', '203.0.113.9', 'Browser B'))
    expect(res.status).toBe(200)
    expect(h.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'suspicious_admin_access', severity: 'info',
      outcome: 'session_indicator_changed',
      detail: expect.objectContaining({
        session_ip_changed: true, user_agent_changed: true,
        actions: ['observe'],
      }),
    }))
  })

  it('fails revoked privileged sessions as JSON and clears the cookie', async () => {
    h.live = false
    const res = await proxy(req('/api/super-admin/security-incidents'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(res.headers.get('set-cookie')).toMatch(/session=.*(?:Max-Age=0|Expires=)/i)
  })
})
