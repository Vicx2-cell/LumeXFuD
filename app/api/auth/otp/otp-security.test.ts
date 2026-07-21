import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeReq } from '@/test/helpers/kit'

const state = vi.hoisted(() => ({
  phoneAllowed: true,
  networkAllowed: true,
  verifyAllowed: true,
  confirmOk: true,
  stored: null as { reference: string; purpose: 'application' } | null,
}))

const calls = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  confirmOtp: vi.fn(),
  event: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  phoneLimit: vi.fn(),
  genericLimit: vi.fn(),
  verifyLimit: vi.fn(),
}))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = calls.redisGet.mockImplementation(async () => state.stored)
    set = calls.redisSet.mockResolvedValue('OK')
    del = calls.redisDel.mockResolvedValue(1)
  },
}))
vi.mock('@/lib/sendchamp', () => ({
  sendOtp: calls.sendOtp.mockImplementation(async () => ({ ok: true, reference: 'provider-ref' })),
  confirmOtp: calls.confirmOtp.mockImplementation(async () => state.confirmOk ? { ok: true } : { ok: false, error: 'bad' }),
}))
vi.mock('@/lib/pin-auth', () => ({ findAuthUserByPhone: async () => null }))
vi.mock('@/lib/features', () => ({ getFeature: async () => true }))
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => null }))
vi.mock('@/lib/blocklist', () => ({ isPhoneBlocked: async () => false }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitOtpSend: calls.phoneLimit.mockImplementation(async () => ({ success: state.phoneAllowed, remaining: 0, reset: 0 })),
  rateLimitGeneric: calls.genericLimit.mockImplementation(async () => ({ success: state.networkAllowed, remaining: 0, reset: 0 })),
  rateLimitOtpVerify: calls.verifyLimit.mockImplementation(async () => ({ success: state.verifyAllowed, remaining: 0, reset: 0 })),
}))
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: calls.event.mockResolvedValue(undefined) }))
vi.mock('@/lib/phone-verify', () => ({
  signPhoneVerified: async () => 'signed-proof',
  PHONE_VERIFIED_COOKIE: 'phone_verified',
  verifiedCookieOptions: () => ({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 600 }),
}))

beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
  state.phoneAllowed = true
  state.networkAllowed = true
  state.verifyAllowed = true
  state.confirmOk = true
  state.stored = null
  vi.clearAllMocks()
})

describe('OTP abuse controls', () => {
  it('blocks the paid send before provider traffic when the phone cap is exceeded', async () => {
    state.phoneAllowed = false
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({
      url: 'http://localhost/api/auth/otp/send',
      body: { phone: '08012345678', purpose: 'application' },
      headers: { 'x-forwarded-for': '198.51.100.4', 'x-request-id': 'forged-request' },
    }))

    expect(response.status).toBe(429)
    expect(calls.sendOtp).not.toHaveBeenCalled()
    expect(calls.phoneLimit).toHaveBeenCalledWith('+2348012345678')
    expect(calls.genericLimit).toHaveBeenCalledWith('otp:send:ip:198.51.100.4', 60, 3600, true)
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get('x-request-id')).not.toBe('forged-request')
    expect(await response.json()).toEqual({ error: 'Too many requests. Please wait and try again.' })
    expect(calls.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'ratelimit_hit', outcome: 'rate_limited', requestId: expect.any(String),
    }))
  })

  it('allows a normal send and records no phone number or provider reference', async () => {
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({
      url: 'http://localhost/api/auth/otp/send',
      body: { phone: '08012345678', purpose: 'application' },
      headers: { 'x-forwarded-for': '198.51.100.4' },
    }))

    expect(response.status).toBe(200)
    expect(calls.sendOtp).toHaveBeenCalledWith('+2348012345678')
    expect(calls.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'otp_sent', outcome: 'sent', detail: { purpose: 'application' },
    }))
  })

  it('records resend cooldown attempts without calling the provider', async () => {
    state.stored = { reference: 'existing-ref', purpose: 'application' }
    const { POST } = await import('./send/route')
    const response = await POST(makeReq({
      url: 'http://localhost/api/auth/otp/send',
      body: { phone: '08012345678', purpose: 'application' },
    }))

    expect(response.status).toBe(429)
    expect(calls.sendOtp).not.toHaveBeenCalled()
    expect(calls.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'ratelimit_hit', outcome: 'rate_limited',
    }))
  })

  it('records an incorrect OTP without minting a proof cookie', async () => {
    state.stored = { reference: 'provider-ref', purpose: 'application' }
    state.confirmOk = false
    const { POST } = await import('./verify/route')
    const response = await POST(makeReq({
      url: 'http://localhost/api/auth/otp/verify',
      body: { phone: '08012345678', code: '111111' },
      headers: { 'x-forwarded-for': '203.0.113.5' },
    }))

    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(calls.event).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'otp_fail', outcome: 'rejected',
    }))
  })

  it('rate-limits repeated verification and does not call the provider', async () => {
    state.verifyAllowed = false
    const { POST } = await import('./verify/route')
    const response = await POST(makeReq({
      url: 'http://localhost/api/auth/otp/verify',
      body: { phone: '08012345678', code: '111111' },
    }))

    expect(response.status).toBe(429)
    expect(calls.confirmOtp).not.toHaveBeenCalled()
    expect(calls.event).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ratelimit_hit' }))
  })
})
