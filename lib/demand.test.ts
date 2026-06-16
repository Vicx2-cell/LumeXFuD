import { describe, it, expect } from 'vitest'
import { computeForecast } from './demand'

const HOUR = 3_600_000
const DAY = 24 * HOUR

// Build a UTC instant whose Africa/Lagos (UTC+1) wall-clock hour == lagosHour,
// on the calendar day `daysAgo` before `nowMs`.
function at(nowMs: number, daysAgo: number, lagosHour: number, min = 0): number {
  const d = new Date(nowMs - daysAgo * DAY)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), lagosHour - 1, min)
}

// Now = Lagos 13:30 on a fixed day.
const NOW = Date.UTC(2026, 5, 13, 12, 30)

// 21 days of history: a lunch rush (Lagos 13:00) and a dinner rush (Lagos 19:00).
function steadyHistory(): number[] {
  const ts: number[] = []
  for (let d = 1; d <= 21; d++) {
    for (const m of [5, 25, 45]) {
      ts.push(at(NOW, d, 13, m))
      ts.push(at(NOW, d, 19, m))
    }
  }
  return ts
}

describe('computeForecast', () => {
  it('uses the full window as sample size and reports high confidence with rich history', () => {
    const f = computeForecast('v1', steadyHistory(), NOW)
    expect(f.sampleSize).toBe(21 * 6)
    expect(f.confidence).toBe('high')
    expect(f.expectedNextHour).toBeGreaterThanOrEqual(1)
    expect(['quiet', 'normal', 'high', 'surge']).toContain(f.level)
  })

  it('flags a surge when the last hour spikes above the seasonal norm', () => {
    const base = steadyHistory()
    const steady = computeForecast('v1', [...base, at(NOW, 0, 13, 5), at(NOW, 0, 13, 20), at(NOW, 0, 13, 28)], NOW)

    // Same history, but a burst of orders in the last 60 min.
    const spikeTs = [...base]
    for (let i = 0; i < 10; i++) spikeTs.push(NOW - i * 4 * 60_000) // 10 orders in last ~40 min
    const spike = computeForecast('v1', spikeTs, NOW)

    expect(spike.recentLastHour).toBeGreaterThanOrEqual(10)
    expect(['high', 'surge']).toContain(spike.level)
    expect(spike.expectedNextHour).toBeGreaterThan(steady.expectedNextHour)
  })

  it('marks confidence low when there is barely any history', () => {
    const f = computeForecast('v1', [at(NOW, 1, 13), at(NOW, 2, 13), at(NOW, 3, 19)], NOW)
    expect(f.confidence).toBe('low')
  })

  it('ignores orders older than the 28-day window', () => {
    const f = computeForecast('v1', [at(NOW, 40, 13), at(NOW, 50, 13)], NOW)
    expect(f.sampleSize).toBe(0)
    expect(f.expectedNextHour).toBe(0)
  })
})
