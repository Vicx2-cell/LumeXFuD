import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSameOriginBrowserRequest } from '@/lib/security'

const headers = (values: Record<string, string>) => new Headers(values)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('same-origin browser provenance guard', () => {
  it('blocks cross-site browser requests that can carry SameSite=Lax cookies on top-level GET', () => {
    expect(isSameOriginBrowserRequest(headers({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('allows same-origin fetches and user-initiated direct navigations', () => {
    expect(isSameOriginBrowserRequest(headers({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(isSameOriginBrowserRequest(headers({ 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('uses Origin/Referer fallback and fails closed for missing provenance in production', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://lumexfud.com.ng')
    expect(isSameOriginBrowserRequest(headers({ origin: 'https://lumexfud.com.ng' }))).toBe(true)
    expect(isSameOriginBrowserRequest(headers({ referer: 'https://evil.example/path' }))).toBe(false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(isSameOriginBrowserRequest(headers({}))).toBe(false)
  })
})
