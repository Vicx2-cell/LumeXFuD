import { describe, expect, it } from 'vitest'
import { canPublishFeedPost, storyStatusForPublisher, type FeedPermissionProfile } from './permissions'

function profile(profileKind: string): FeedPermissionProfile {
  return {
    id: `${profileKind}-profile`,
    profile_kind: profileKind,
    is_verified: false,
    is_system_account: false,
    official_badge_kind: null,
    premium_verified: false,
    premium_label: null,
    vendor_id: null,
  }
}

describe('customer feed publishing rules', () => {
  it('prevents customers from publishing permanent feed posts', () => {
    expect(canPublishFeedPost(profile('customer'), null)).toBe(false)
  })

  it('always sends customer stories to moderation', () => {
    expect(storyStatusForPublisher(profile('customer'), null)).toBe('under_review')
  })

  it('allows non-customer account types to publish posts', () => {
    expect(canPublishFeedPost(profile('vendor'), null)).toBe(true)
    expect(canPublishFeedPost(profile('admin'), null)).toBe(true)
    expect(canPublishFeedPost(profile('rider'), null)).toBe(true)
  })
})
