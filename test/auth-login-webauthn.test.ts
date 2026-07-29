/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUserRow } from '@/lib/pin-auth'
import { makeReq, makeDb, type DbRows } from './helpers/kit'

const h = vi.hoisted(() => ({
  rows: {} as DbRows,
  createSession: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb(h) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitPinLogin: async () => ({ success: true, remaining: 99, reset: 0 }) }))
vi.mock('@/lib/features', () => ({ getFeature: async () => true }))
vi.mock('@/lib/controls', () => ({ isLockedDown: async () => false }))
vi.mock('@/lib/pin-auth', () => ({
  compareSecret: async () => true,
  findAuthUserByPhone: async () => ({
    role: 'vendor',
    table: 'vendors',
    user: {
      id: 'vendor-1',
      phone: '+2348012345678',
      login_pin_hash: 'hash',
      pin_attempts: 0,
      pin_locked_until: null,
      pin_reset_pending: false,
      recovery_attempts: 0,
      recovery_locked_until: null,
    } as AuthUserRow,
  }),
  hashSecret: async (value: string) => `hash:${value}`,
  validatePin: () => {},
  AUTH_USER_COLUMNS: 'id',
}))
vi.mock('@/lib/webauthn', () => ({
  signMfaPending: async () => 'mfa-token',
  MFA_COOKIE: 'mfa_pending',
  shortCookie: () => ({ path: '/', httpOnly: true, secure: false, sameSite: 'strict' as const, maxAge: 300 }),
}))
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  createSession: h.createSession,
}))

beforeEach(() => {
  h.rows = {}
  h.createSession.mockReset()
})

describe('auth login passkey step-up', () => {
  it('returns webauthn_required instead of issuing a session when a passkey exists', async () => {
    h.rows = {
      webauthn_credentials: {
        data: [{ id: 'cred-1' }],
        error: null,
      },
    }

    const mod: any = await import('@/app/api/auth/login/route')
    const res = await mod.POST(makeReq({
      method: 'POST',
      url: 'http://localhost/api/auth/login',
      body: { phone: '+2348012345678', pin: '123456' },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ webauthn_required: true })
    expect(h.createSession).not.toHaveBeenCalled()
  })
})
