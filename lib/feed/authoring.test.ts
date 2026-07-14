import { describe, expect, it } from 'vitest'
import { canPublishAsLumex, feedAuthorModeLabel, normalizeFeedAuthorMode } from './authoring'

describe('feed authoring', () => {
  it('only allows admin roles to publish as LumeX Fud', () => {
    expect(canPublishAsLumex('customer')).toBe(false)
    expect(canPublishAsLumex('vendor')).toBe(false)
    expect(canPublishAsLumex('admin')).toBe(true)
    expect(canPublishAsLumex('super_admin')).toBe(true)
  })

  it('normalizes invalid author requests back to self', () => {
    expect(normalizeFeedAuthorMode('customer', 'lumex')).toBe('self')
    expect(normalizeFeedAuthorMode('admin', 'lumex')).toBe('lumex')
    expect(normalizeFeedAuthorMode('super_admin', 'self')).toBe('self')
  })

  it('labels the selected author clearly', () => {
    expect(feedAuthorModeLabel('self')).toBe('My profile')
    expect(feedAuthorModeLabel('lumex')).toBe('LumeX Fud')
  })
})
