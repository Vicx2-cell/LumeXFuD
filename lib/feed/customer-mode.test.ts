import { describe, expect, it } from 'vitest'
import { blockedCustomerTrendTags, isCustomerVisibleDiscoveryCandidate, isCustomerVisibleFeedCandidate } from './customer-mode'
import type { FeedCandidate } from './types'

function candidate(overrides: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    id: 'visible-1',
    authorProfileId: 'profile-1',
    authorHandle: 'bitesbymira',
    authorDisplayName: 'Bites by Mira',
    body: 'Fresh rice and chicken now available.',
    hashtags: ['jollof', 'uturu'],
    media: [],
    menuItems: [],
    postKind: 'TEXT',
    status: 'published',
    visibility: 'public',
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    ...overrides,
  } as FeedCandidate
}

describe('feed customer mode rules', () => {
  it('blocks exact internal and QA records only', () => {
    expect(isCustomerVisibleFeedCandidate(candidate({ id: '1001d71b-9d80-4184-9597-f13055e87ece', authorHandle: 'lumex-fud-official', body: 'order from one or two vendor today' }))).toBe(false)
    expect(isCustomerVisibleFeedCandidate(candidate({ authorHandle: 'qa-feed-kitchen', authorDisplayName: 'QA Feed Kitchen', body: 'QA feed fixture: live menu image', hashtags: ['jollof', 'placeholder'] }))).toBe(false)
    expect(isCustomerVisibleFeedCandidate(candidate())).toBe(true)
  })

  it('keeps discovery filtered only for explicit QA markers', () => {
    expect(isCustomerVisibleDiscoveryCandidate(candidate({ authorDisplayName: 'Super Admin', authorHandle: 'super_admin-0c216073-d6ea' }))).toBe(false)
    expect(blockedCustomerTrendTags(['#uturu', '#placeholder', 'jollof'])).toEqual(['#uturu', 'jollof'])
  })
})
