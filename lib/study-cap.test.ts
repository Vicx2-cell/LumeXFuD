import { describe, it, expect } from 'vitest'
import { consumePractice, lagosDate, FREE_PRACTICE_CAP, type CapStore } from './study-cap'

// In-memory store keyed by `${userId}:${date}` — mirrors study_daily_usage.
function memStore(seed: Record<string, number> = {}): CapStore & { counts: Record<string, number> } {
  const counts: Record<string, number> = { ...seed }
  return {
    counts,
    async get(userId, date) {
      return counts[`${userId}:${date}`] ?? 0
    },
    async increment(userId, date) {
      counts[`${userId}:${date}`] = (counts[`${userId}:${date}`] ?? 0) + 1
    },
  }
}

const NOW = Date.UTC(2026, 5, 13, 12, 0) // Lagos 13:00

describe('lagosDate', () => {
  it('uses the Africa/Lagos calendar day (UTC+1)', () => {
    // 23:30 UTC on Jun 13 is 00:30 Lagos on Jun 14.
    expect(lagosDate(Date.UTC(2026, 5, 13, 23, 30))).toBe('2026-06-14')
    expect(lagosDate(Date.UTC(2026, 5, 13, 12, 0))).toBe('2026-06-13')
  })
})

describe('consumePractice (daily cap)', () => {
  it('allows exactly FREE_PRACTICE_CAP questions, then blocks the next', async () => {
    const store = memStore()
    const results = []
    for (let i = 0; i < FREE_PRACTICE_CAP; i++) {
      results.push(await consumePractice(store, 'u1', NOW))
    }
    expect(results.every((r) => r.allowed)).toBe(true)
    expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1, 0])

    // The 6th request is blocked server-side and does NOT increment.
    const sixth = await consumePractice(store, 'u1', NOW)
    expect(sixth.allowed).toBe(false)
    expect(sixth.remaining).toBe(0)
    expect(store.counts[`u1:${lagosDate(NOW)}`]).toBe(FREE_PRACTICE_CAP) // not 6
  })

  it('does not increment when already at the cap', async () => {
    const date = lagosDate(NOW)
    const store = memStore({ [`u1:${date}`]: FREE_PRACTICE_CAP })
    const r = await consumePractice(store, 'u1', NOW)
    expect(r.allowed).toBe(false)
    expect(store.counts[`u1:${date}`]).toBe(FREE_PRACTICE_CAP)
  })

  it('caps per user (one user hitting the limit does not affect another)', async () => {
    const date = lagosDate(NOW)
    const store = memStore({ [`u1:${date}`]: FREE_PRACTICE_CAP })
    expect((await consumePractice(store, 'u1', NOW)).allowed).toBe(false)
    expect((await consumePractice(store, 'u2', NOW)).allowed).toBe(true)
  })

  it('resets on a new Lagos day', async () => {
    const store = memStore({ [`u1:${lagosDate(NOW)}`]: FREE_PRACTICE_CAP })
    const tomorrow = NOW + 24 * 3_600_000
    const r = await consumePractice(store, 'u1', tomorrow)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(FREE_PRACTICE_CAP - 1)
  })

  it('honours a custom cap', async () => {
    const store = memStore()
    expect((await consumePractice(store, 'u1', NOW, 1)).allowed).toBe(true)
    expect((await consumePractice(store, 'u1', NOW, 1)).allowed).toBe(false)
  })
})
