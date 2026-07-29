import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase/server', () => ({
  createSupabaseAdmin: () => {
    throw new Error('settings unavailable')
  },
}))

import { FEATURES, getFeature } from './features'

describe('feature defaults', () => {
  it('keeps incomplete study tooling disabled by default', () => {
    expect(FEATURES.find((feature) => feature.key === 'study')?.default).toBe(false)
  })

  it('keeps stored-value sponsor top-ups disabled by default', () => {
    expect(FEATURES.find((feature) => feature.key === 'sponsor_topup')?.default).toBe(false)
  })

  it('fails closed for unknown feature keys', async () => {
    await expect(getFeature('misspelled_or_removed_feature')).resolves.toBe(false)
  })
})
