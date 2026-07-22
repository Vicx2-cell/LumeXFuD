import { describe, expect, it } from 'vitest'
import {
  createGroupParticipantToken,
  groupParticipantCookieName,
  hashGroupParticipantToken,
} from '@/lib/group-participant-session'

describe('group participant session capabilities', () => {
  it('creates high-entropy opaque tokens and stores only stable hashes', () => {
    const token = createGroupParticipantToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hashGroupParticipantToken(token)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashGroupParticipantToken(token)).toBe(hashGroupParticipantToken(token))
  })

  it('normalizes cookie names without exposing the token', () => {
    expect(groupParticipantCookieName('ab-c 12')).toBe('lx_group_ABC12')
  })
})
