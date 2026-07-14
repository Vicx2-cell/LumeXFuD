import type { FeedCandidate } from './types'

const BLOCKED_POST_IDS = new Set([
  '1001d71b-9d80-4184-9597-f13055e87ece',
  '28df6489-9ab5-413b-8f7b-d02e39445deb',
  'fab85997-3fc9-45e4-bea7-e1ed0c92dd24',
  'e9630f0b-03c2-4613-b6b9-bf41f4da78ab',
  '848a6b95-d023-41c6-81a4-a7e5391dc2b5',
  'dbabf6a7-bece-46a4-9bd5-0fb9abbc7f97',
  'b2562710-021c-4483-a31f-00f54a2d61b3',
  '14ead7aa-e3c7-4625-bde2-17f686d26ee3',
  'f1e5a1ba-70b1-4b0d-a0e7-1230fa1ef5aa',
])

const BLOCKED_HANDLES = new Set([
  'qa-feed-kitchen',
  'super_admin-0c216073-d6ea',
])

const BLOCKED_DISPLAY_NAMES = new Set([
  'qa feed kitchen',
  'super admin',
])

const BLOCKED_BODY_TEXTS = new Set([
  'order from one or two vendor today',
  'order from us and get your next delivery free. valid till thursday',
  'pp',
  'right',
  'ogogoro.. lol',
  'order from us today, and get unlimited free delivery today',
  'today’s lumex pick is ready. short, sharp, and worth a look.',
  "today's lumex pick is ready. short, sharp, and worth a look.",
])

const BLOCKED_TAGS = new Set([
  'placeholder',
  'noimage',
])

function normalize(value?: string | null) {
  return String(value ?? '').trim().toLowerCase()
}

function matchesBlockedTag(tags?: string[] | null) {
  return (tags ?? []).some((tag) => BLOCKED_TAGS.has(normalize(tag).replace(/^#/, '')))
}

export function isCustomerVisibleFeedCandidate(candidate: Pick<FeedCandidate, 'id' | 'authorHandle' | 'authorDisplayName' | 'body' | 'hashtags'>) {
  if (BLOCKED_POST_IDS.has(candidate.id)) return false
  if (BLOCKED_HANDLES.has(normalize(candidate.authorHandle))) return false
  if (BLOCKED_DISPLAY_NAMES.has(normalize(candidate.authorDisplayName))) return false
  if (BLOCKED_BODY_TEXTS.has(normalize(candidate.body))) return false
  if (matchesBlockedTag(candidate.hashtags)) return false
  return true
}

export function isCustomerVisibleDiscoveryCandidate(candidate: Pick<FeedCandidate, 'id' | 'authorHandle' | 'authorDisplayName' | 'body' | 'hashtags'>) {
  return isCustomerVisibleFeedCandidate(candidate)
}

export function blockedCustomerTrendTags(tags?: string[] | null) {
  return (tags ?? []).filter((tag) => !BLOCKED_TAGS.has(normalize(tag).replace(/^#/, '')))
}
