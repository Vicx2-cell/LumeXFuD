import { describe, expect, it, vi } from 'vitest'
import { POST } from './route'

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => null),
}))

describe('feed like route', () => {
  it('rejects unauthorized requests', async () => {
    const res = await POST(new Request('http://localhost', { method: 'POST', body: '{}' }) as never, { params: Promise.resolve({ id: 'post-1' }) })
    expect(res.status).toBe(401)
  })
})
