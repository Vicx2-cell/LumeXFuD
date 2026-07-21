import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ error: null as { message: string } | null }))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({
      upsert: async () => ({ error: state.error }),
      delete: () => ({ eq: async () => ({ error: state.error }) }),
    }),
  }),
}))

import { blockPhone, unblockPhone } from '@/lib/blocklist'

beforeEach(() => { state.error = null })

describe('blocklist mutation failures', () => {
  it('does not report a block as successful when persistence fails', async () => {
    state.error = { message: 'db unavailable' }
    await expect(blockPhone('+2348012345678', 'review', 'admin')).rejects.toThrow(/persist phone block/i)
  })

  it('does not report an unblock as successful when deletion fails', async () => {
    state.error = { message: 'db unavailable' }
    await expect(unblockPhone('+2348012345678')).rejects.toThrow(/remove phone block/i)
  })

  it('allows confirmed mutations', async () => {
    await expect(blockPhone('+2348012345678', null, 'admin')).resolves.toBeUndefined()
    await expect(unblockPhone('+2348012345678')).resolves.toBeUndefined()
  })
})
