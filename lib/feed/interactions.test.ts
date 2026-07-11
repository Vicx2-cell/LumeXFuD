import { describe, expect, it, vi } from 'vitest'
import { toggleFollow } from './interactions'

vi.mock('@/lib/feed/service', () => ({
  ensureSocialProfileForSession: vi.fn(async () => ({
    id: 'profile-1',
    profile_kind: 'customer',
    handle: 'customer-1',
    display_name: 'Customer One',
    campus_id: null,
    zone_id: null,
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { id: 'profile-2' } })),
        })),
      })),
    })),
  })),
}))

describe('feed interactions', () => {
  it('rejects follow self-targeting', async () => {
    await expect(toggleFollow('profile-1', true)).rejects.toThrow('You cannot follow yourself')
  })
})
