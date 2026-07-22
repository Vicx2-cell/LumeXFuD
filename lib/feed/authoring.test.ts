import { describe, expect, it } from 'vitest'
import { canAttachFeedMenuItem, canEditFeedPost, canPublishAsLumex, feedAuthorModeLabel, normalizeFeedAuthorMode } from './authoring'

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

  it('allows drafts and recent published posts to be edited', () => {
    const now = new Date('2026-07-22T12:00:00.000Z').getTime()
    expect(canEditFeedPost({ status: 'draft' }, now)).toBe(true)
    expect(canEditFeedPost({ status: 'published', published_at: '2026-07-21T13:00:00.000Z' }, now)).toBe(true)
    expect(canEditFeedPost({ status: 'published', published_at: '2026-07-20T12:00:00.000Z' }, now)).toBe(false)
  })

  it('never edits archived or deleted posts', () => {
    expect(canEditFeedPost({ status: 'draft', is_archived: true })).toBe(false)
    expect(canEditFeedPost({ status: 'draft', deleted_at: new Date().toISOString() })).toBe(false)
  })

  it('attaches only live menu items', () => {
    expect(canAttachFeedMenuItem({ is_available: true, deleted_at: null })).toBe(true)
    expect(canAttachFeedMenuItem({ is_available: false, deleted_at: null })).toBe(false)
    expect(canAttachFeedMenuItem({ is_available: true, deleted_at: new Date().toISOString() })).toBe(false)
  })
})
