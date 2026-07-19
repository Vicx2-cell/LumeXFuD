import { describe, expect, it } from 'vitest'
import { canCreateStory, canPublishFeedPost, storyStatusForPublisher, type FeedPermissionProfile } from './permissions'

function profile(kind: string): FeedPermissionProfile {
  return { id: `${kind}-id`, profile_kind: kind, is_verified: false, is_system_account: false, official_badge_kind: null, premium_verified: false, premium_label: null, vendor_id: null }
}

describe('feed publishing boundaries', () => {
  it('allows customers to submit moderated stories but not posts', () => {
    const customer = profile('customer')
    expect(canPublishFeedPost(customer, null)).toBe(false)
    expect(canCreateStory(customer, null)).toBe(true)
    expect(storyStatusForPublisher(customer, null)).toBe('under_review')
  })

  it('does not allow riders to create posts or stories', () => {
    const rider = profile('rider')
    expect(canPublishFeedPost(rider, null)).toBe(false)
    expect(canCreateStory(rider, null)).toBe(false)
  })
})
