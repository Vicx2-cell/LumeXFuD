import { describe, it, expect, vi } from 'vitest'

// calculateReleaseTime is pure, but lib/wallet pulls in the supabase admin client
// at import — stub it so the unit test stays DB-free.
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => ({}) }))

import { calculateReleaseTime, DEFAULT_HOLD_POLICY } from '@/lib/wallet'

const base = new Date('2026-06-16T12:00:00.000Z')
const heldMinutes = (release: Date) => Math.round((release.getTime() - base.getTime()) / 60_000)

// Model the user asked for: 5h base hold, scaled DOWN by trust tier, never below
// a 1h floor — so every order is held, and even a DIAMOND account has a window
// in which funds can be locked/refunded.
describe('hold policy — 5h base, tier-scaled, 1h floor', () => {
  it('BRONZE established account holds the full 5h base', () => {
    expect(heldMinutes(calculateReleaseTime('RIDER', 'BRONZE', 10, base))).toBe(300)
    expect(heldMinutes(calculateReleaseTime('VENDOR', 'BRONZE', 10, base))).toBe(300)
  })

  it('SILVER halves the hold to 2h30', () => {
    expect(heldMinutes(calculateReleaseTime('RIDER', 'SILVER', 60, base))).toBe(150)
  })

  it('GOLD takes 75% off → 1h15', () => {
    expect(heldMinutes(calculateReleaseTime('VENDOR', 'GOLD', 250, base))).toBe(75)
  })

  it('DIAMOND never releases faster than the 1h floor', () => {
    expect(heldMinutes(calculateReleaseTime('RIDER', 'DIAMOND', 600, base))).toBe(60)
  })

  it('new accounts get the full base with no tier reduction', () => {
    expect(heldMinutes(calculateReleaseTime('RIDER', 'BRONZE', 1, base))).toBe(300)
  })

  it('the hold is NEVER zero for any tier (refund/freeze window always exists)', () => {
    for (const tier of ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const) {
      const held = heldMinutes(calculateReleaseTime('VENDOR', tier, 1000, base))
      expect(held).toBeGreaterThanOrEqual(DEFAULT_HOLD_POLICY.floorMin)
    }
  })
})
