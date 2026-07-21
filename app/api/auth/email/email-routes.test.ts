import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeReq, session } from '@/test/helpers/kit'
import type { SessionPayload } from '@/lib/session'

const h = vi.hoisted(() => ({
  actor: null as SessionPayload | null,
  allowed: true,
  sendStatus: 'sent' as 'sent' | 'failed',
  codeResult: 'ok' as 'ok' | 'expired',
}))

const calls = vi.hoisted(() => ({
  store: vi.fn(),
  clear: vi.fn(),
  send: vi.fn(),
  sign: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => h.actor }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitGeneric: calls.rateLimit.mockImplementation(async () => ({ success: h.allowed, remaining: h.allowed ? 1 : 0, reset: 0 })),
}))
vi.mock('@/lib/email/send-email', () => ({
  normalizeEmail: (value: unknown) => typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null,
  sendEmail: calls.send.mockImplementation(async () => ({ status: h.sendStatus })),
}))
vi.mock('@/lib/email/templates', () => ({
  renderEmailVerification: () => ({ subject: 'Verify', html: '<p>Verify</p>', text: 'Verify' }),
}))
vi.mock('@/lib/email-verify', () => ({
  EMAIL_VERIFIED_COOKIE: 'email_verified',
  clearEmailCode: calls.clear.mockResolvedValue(undefined),
  generateEmailCode: () => '123456',
  storeEmailCode: calls.store.mockResolvedValue(undefined),
  checkEmailCode: async () => h.codeResult,
  signEmailVerified: calls.sign.mockResolvedValue('signed-proof'),
  emailVerifiedCookieOptions: () => ({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 1200 }),
}))

beforeEach(() => {
  h.actor = null
  h.allowed = true
  h.sendStatus = 'sent'
  h.codeResult = 'ok'
  vi.clearAllMocks()
})

describe('email verification route authorization', () => {
  it('allows the public signup proof flow without a session', async () => {
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({ body: { email: 'Owner@Example.com', purpose: 'signup' } }))

    expect(response.status).toBe(200)
    expect(calls.store).toHaveBeenCalledWith('owner@example.com', 'signup', '123456')
    expect(calls.send).toHaveBeenCalledOnce()
    expect(calls.rateLimit).toHaveBeenCalledWith(expect.any(String), 3, 10 * 60, true)
  })

  it.each([
    ['admin_create', null],
    ['admin_create', session('customer')],
    ['account_change', null],
  ] as const)('denies privileged purpose %s to an unauthorized actor', async (purpose, actor) => {
    h.actor = actor
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({ body: { email: 'owner@example.com', purpose } }))

    expect(response.status).toBe(403)
    expect(calls.store).not.toHaveBeenCalled()
    expect(calls.send).not.toHaveBeenCalled()
  })

  it('allows an administrator to request an admin-create proof', async () => {
    h.actor = session('admin')
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({ body: { email: 'owner@example.com', purpose: 'admin_create' } }))

    expect(response.status).toBe(200)
    expect(calls.send).toHaveBeenCalledOnce()
  })

  it('rate-limits before storing or sending another code', async () => {
    h.allowed = false
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({ body: { email: 'owner@example.com', purpose: 'signup' } }))

    expect(response.status).toBe(429)
    expect(calls.store).not.toHaveBeenCalled()
    expect(calls.send).not.toHaveBeenCalled()
  })

  it('sets an HttpOnly proof cookie only after a valid code', async () => {
    const { POST } = await import('./verify/route')
    const response = await POST(makeReq({ body: { email: 'owner@example.com', purpose: 'signup', code: '123456' } }))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('email_verified=signed-proof')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(calls.sign).toHaveBeenCalledWith('owner@example.com', 'signup')
  })

  it('does not mint a proof for an incorrect or expired code', async () => {
    h.codeResult = 'expired'
    const { POST } = await import('./verify/route')
    const response = await POST(makeReq({ body: { email: 'owner@example.com', purpose: 'signup', code: '000000' } }))

    expect(response.status).toBe(400)
    expect(calls.sign).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
