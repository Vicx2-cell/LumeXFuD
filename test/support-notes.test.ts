/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionPayload } from '@/lib/session'
import { makeReq, makeDb, session, type DbRows } from './helpers/kit'

const h = vi.hoisted(() => ({
  session: null as SessionPayload | null,
  rows: {} as DbRows,
}))

vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  getCurrentUser: async () => h.session,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: async () => ({ success: true, remaining: 99, reset: 0 }) }))

beforeEach(() => {
  h.session = null
  h.rows = {}
})

describe('support notes operations', () => {
  it('keeps support notes service-role only in the migration', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '142_support_notes.sql'), 'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS support_notes/i)
    expect(sql).toMatch(/ALTER TABLE support_notes ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/REVOKE ALL ON TABLE support_notes FROM anon, authenticated/i)
    expect(sql).toMatch(/auth\.role\(\) = 'service_role'/i)
    expect(sql).toMatch(/idx_support_notes_subject/i)
    expect(sql).toMatch(/idx_support_notes_phone/i)
  })

  it('allows admins to create an internal note attached to a phone', async () => {
    h.session = session('admin', 'adm1')
    h.rows = {
      support_notes: {
        data: {
          id: 'note-1',
          subject_type: 'phone',
          subject_id: null,
          phone: '+2348012345678',
          note: 'Customer called about missing receipt',
          pinned: false,
          created_by: '+234800000500',
          created_by_role: 'admin',
          created_at: '2026-07-21T10:00:00.000Z',
        },
        error: null,
      },
      audit_logs: { data: null, error: null },
    }

    const mod: any = await import('@/app/api/admin/support-notes/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: 'http://localhost/api/admin/support-notes',
      body: { subject_type: 'phone', phone: '08012345678', note: 'Customer called about missing receipt' },
    }))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.note.id).toBe('note-1')
  })

  it('rejects notes without a subject or phone', async () => {
    h.session = session('admin', 'adm1')
    const mod: any = await import('@/app/api/admin/support-notes/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: 'http://localhost/api/admin/support-notes',
      body: { subject_type: 'order', note: 'Needs follow-up' },
    }))
    expect(res.status).toBe(400)
  })
})
