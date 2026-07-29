import { describe, expect, it } from 'vitest'
import { isReportShake, SHAKE_COOLDOWN_MS } from './shake-report'

describe('isReportShake', () => {
  it('opens only for a strong motion outside the cooldown', () => {
    expect(isReportShake({ x: 20, y: 20, z: 0, now: 10_000, lastTriggeredAt: 0 })).toBe(true)
    expect(isReportShake({ x: 3, y: 3, z: 3, now: 10_000, lastTriggeredAt: 0 })).toBe(false)
    expect(isReportShake({ x: 30, y: 0, z: 0, now: 10_000, lastTriggeredAt: 10_000 - SHAKE_COOLDOWN_MS + 1 })).toBe(false)
  })
})
