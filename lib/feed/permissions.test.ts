import { describe, expect, it } from 'vitest'
import { canCreateStory, canPublishFeedPost, storyStatusForPublisher, type FeedPermissionProfile, type FeedPermissionVendor } from './permissions'

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

  it('allows only approved feed publishers to publish posts', () => {
    const approvedVendor: FeedPermissionVendor = { id: 'vendor', approval_state: 'approved', is_active: true, is_verified: true, business_verified: false, id_verified: false }
    expect(canPublishFeedPost({ ...profile('vendor'), vendor_id: 'vendor' }, approvedVendor)).toBe(true)
    expect(canPublishFeedPost({ ...profile('admin'), is_system_account: true, official_badge_kind: 'official' }, null)).toBe(true)
    expect(canPublishFeedPost(profile('rider'), null)).toBe(false)
  })

  it('does not allow riders to create posts or stories', () => {
    expect(canPublishFeedPost(profile('rider'), null)).toBe(false)
    expect(canCreateStory(profile('rider'), null)).toBe(false)
  })
})
