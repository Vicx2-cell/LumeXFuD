import { describe, expect, it } from 'vitest'
import { busyModeBuffer } from './busy-mode'

describe('busyModeBuffer', () => {
  it('does not apply the buffer at or below the preparing threshold', () => {
    expect(busyModeBuffer({ threshold: 3, bufferMinutes: 12 }, 2)).toBe(0)
    expect(busyModeBuffer({ threshold: 3, bufferMinutes: 12 }, 3)).toBe(0)
  })

  it('applies the configured buffer once preparing orders exceed the threshold', () => {
    expect(busyModeBuffer({ threshold: 3, bufferMinutes: 12 }, 4)).toBe(12)
  })

  it('allows a zero-minute buffer to disable throttling without rejecting orders', () => {
    expect(busyModeBuffer({ threshold: 3, bufferMinutes: 0 }, 4)).toBe(0)
  })
})
