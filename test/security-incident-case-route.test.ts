import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionPayload } from '@/lib/session'

const h = vi.hoisted(() => ({
  session: null as SessionPayload | null,
  eventId: 77 as number | null,
  rpc: vi.fn(async (): Promise<{ data: boolean | null; error: { message: string } | null }> => ({ data: true, error: null })),
}))

vi.mock('@/lib/session', async (original) => ({
  ...(await original<typeof import('@/lib/session')>()),
  getCurrentUser: async () => h.session,
}))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: async () => h.eventId }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({ rpc: h.rpc }),
}))

import { PATCH } from '@/app/api/super-admin/security-incidents/[id]/route'

const incidentId = '11111111-1111-4111-8111-111111111111'
const request = (body: unknown) => new NextRequest(`http://localhost/api/super-admin/security-incidents/${incidentId}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const context = { params: Promise.resolve({ id: incidentId }) }
const session = (role: SessionPayload['role']): SessionPayload => ({
  sessionId: 'session-1', userId: `${role}-1`, phone: '+2348000000000', role,
})

beforeEach(() => {
  h.session = session('super_admin')
  h.eventId = 77
  h.rpc.mockReset()
  h.rpc.mockResolvedValue({ data: true, error: null })
})

describe('security incident human-review route', () => {
  it('rejects anonymous and wrong-role updates before touching evidence', async () => {
    h.session = null
    expect((await PATCH(request({ status: 'RESOLVED', factual_note: 'Reviewed.' }), context)).status).toBe(401)
    h.session = session('admin')
    expect((await PATCH(request({ status: 'RESOLVED', factual_note: 'Reviewed.' }), context)).status).toBe(403)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('rejects missing notes and unsupported status bypasses', async () => {
    expect((await PATCH(request({ status: 'OPEN', factual_note: 'Reviewed.' }), context)).status).toBe(400)
    expect((await PATCH(request({ status: 'FALSE_POSITIVE', factual_note: ' ' }), context)).status).toBe(400)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when an append-only security event cannot be preserved', async () => {
    h.eventId = null
    expect((await PATCH(request({ status: 'FALSE_POSITIVE', factual_note: 'Signals were not corroborated.' }), context)).status).toBe(503)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('passes a factual false-positive transition to the atomic case RPC', async () => {
    const res = await PATCH(request({ status: 'FALSE_POSITIVE', factual_note: ' Signals were not corroborated. ' }), context)
    expect(res.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledWith('update_security_incident_case', expect.objectContaining({
      p_incident_id: incidentId, p_status: 'FALSE_POSITIVE', p_event_id: 77,
      p_factual_note: 'Signals were not corroborated.', p_actions: null,
    }))
  })

  it('does not report success for missing cases or transaction failures', async () => {
    h.rpc.mockResolvedValueOnce({ data: false, error: null })
    expect((await PATCH(request({ status: 'RESOLVED', factual_note: 'No further action.' }), context)).status).toBe(404)
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'conflict' } })
    expect((await PATCH(request({ status: 'RESOLVED', factual_note: 'No further action.' }), context)).status).toBe(500)
  })
})
