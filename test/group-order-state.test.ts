import { describe, expect, it } from 'vitest'
import {
  canTransitionGroupOrder,
  isGroupEditable,
  participantBudgetExceeded,
  validateGroupDeadline,
} from '@/lib/group-order-state'

describe('group order lifecycle', () => {
  it('allows only explicit forward and recovery transitions', () => {
    expect(canTransitionGroupOrder('OPEN', 'VALIDATING')).toBe(true)
    expect(canTransitionGroupOrder('VALIDATING', 'LOCKED')).toBe(true)
    expect(canTransitionGroupOrder('AWAITING_PAYMENT', 'PLACED')).toBe(true)
    expect(canTransitionGroupOrder('PLACED', 'OPEN')).toBe(false)
    expect(canTransitionGroupOrder('CANCELLED', 'OPEN')).toBe(false)
  })

  it('closes edits at lock or deadline', () => {
    const now = Date.parse('2026-07-22T10:00:00Z')
    expect(isGroupEditable('OPEN', '2026-07-22T11:00:00Z', now)).toBe(true)
    expect(isGroupEditable('LOCKED', '2026-07-22T11:00:00Z', now)).toBe(false)
    expect(isGroupEditable('OPEN', '2026-07-22T09:59:59Z', now)).toBe(false)
  })

  it('bounds deadlines and optional budgets', () => {
    const now = Date.parse('2026-07-22T10:00:00Z')
    expect(validateGroupDeadline('2026-07-22T10:10:00Z', now)).toMatch(/15 minutes/i)
    expect(validateGroupDeadline('2026-07-23T11:00:00Z', now)).toMatch(/24 hours/i)
    expect(validateGroupDeadline('2026-07-22T12:00:00Z', now)).toBeNull()
    expect(participantBudgetExceeded(250000, 200000)).toBe(true)
    expect(participantBudgetExceeded(250000, null)).toBe(false)
  })
})
