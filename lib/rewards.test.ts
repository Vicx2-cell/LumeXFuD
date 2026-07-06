import { describe, it, expect } from 'vitest'
import { canSaveReward } from './rewards'

describe('reward saving eligibility', () => {
  it('allows a positive surprise reward to be saved before it is persisted', () => {
    expect(canSaveReward(2500, 'UNOPENED', null)).toBe(true)
    expect(canSaveReward(2500, 'OPENED', null)).toBe(true)
  })

  it('blocks zero-value or already-saved rewards', () => {
    expect(canSaveReward(0, 'OPENED', null)).toBe(false)
    expect(canSaveReward(2500, 'OPENED', 'credit-123')).toBe(false)
  })
})
