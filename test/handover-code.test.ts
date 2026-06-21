import { describe, it, expect } from 'vitest'
import {
  generateHandoverCode,
  normalizeHandoverCode,
  isWellFormedCode,
  hashHandoverCode,
  verifyHandoverCode,
  HANDOVER_CODE_LENGTH,
} from '../lib/handover-code'

// Break-tests for the shared handover-code engine (Invariants I2, I3, I5 + B1).
// These exercise the pure crypto layer with NO database — the money-gating and
// ownership checks live in the routes and are covered by the access-control suite.

const SAFE = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const AMBIGUOUS = ['0', 'O', '1', 'I', 'L', 'U']

describe('handover-code engine', () => {
  it('generates 6-char codes from the unambiguous alphabet only', () => {
    for (let i = 0; i < 2000; i++) {
      const c = generateHandoverCode()
      expect(c).toHaveLength(HANDOVER_CODE_LENGTH)
      for (const ch of c) expect(SAFE).toContain(ch)
      for (const bad of AMBIGUOUS) expect(c).not.toContain(bad)
    }
  })

  it('does not concentrate on any character (no modulo bias)', () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < 6000; i++) for (const ch of generateHandoverCode()) counts[ch] = (counts[ch] ?? 0) + 1
    // Every safe char should appear; none should dominate wildly. With 36k draws
    // over 30 symbols the expected count is ~1200; allow a wide band.
    for (const ch of SAFE) {
      expect(counts[ch] ?? 0).toBeGreaterThan(400)
      expect(counts[ch] ?? 0).toBeLessThan(2400)
    }
  })

  it('produces effectively unique codes', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) seen.add(generateHandoverCode())
    // Collisions over 5k draws in a 30^6 space should be ~0.
    expect(seen.size).toBeGreaterThan(4990)
  })

  it('I3: only ever persists a hash, never the raw code', () => {
    const code = generateHandoverCode()
    const hash = hashHandoverCode(code)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)          // SHA-256 hex
    expect(hash).not.toContain(code)                 // raw not embedded
    expect(hashHandoverCode(code)).toBe(hash)        // deterministic
  })

  it('verifies a correct code (case/space-insensitive) in constant time', () => {
    const code = generateHandoverCode()
    const hash = hashHandoverCode(code)
    expect(verifyHandoverCode(code, hash)).toBe(true)
    expect(verifyHandoverCode(code.toLowerCase(), hash)).toBe(true)
    expect(verifyHandoverCode(` ${code} `, hash)).toBe(true)
    expect(verifyHandoverCode(code.slice(0, 3) + '-' + code.slice(3), hash)).toBe(true)
  })

  it('I2: rejects wrong, malformed, and empty codes, and a null hash', () => {
    const code = generateHandoverCode()
    const hash = hashHandoverCode(code)
    let wrong = generateHandoverCode()
    while (wrong === code) wrong = generateHandoverCode()
    expect(verifyHandoverCode(wrong, hash)).toBe(false)
    expect(verifyHandoverCode('', hash)).toBe(false)
    expect(verifyHandoverCode('ABC', hash)).toBe(false)        // too short
    expect(verifyHandoverCode('0OILU1', hash)).toBe(false)     // ambiguous → not in alphabet
    expect(verifyHandoverCode(code, null)).toBe(false)         // no code issued → nothing verifies
  })

  it('rotation: a new code invalidates the old one (different hash)', () => {
    const a = generateHandoverCode()
    const b = generateHandoverCode()
    const ha = hashHandoverCode(a)
    const hb = hashHandoverCode(b)
    expect(ha).not.toBe(hb)
    // After rotating to b, the old code a must not verify against b's hash.
    if (a !== b) expect(verifyHandoverCode(a, hb)).toBe(false)
  })

  it('well-formedness gate matches the alphabet', () => {
    expect(isWellFormedCode(generateHandoverCode())).toBe(true)
    expect(isWellFormedCode('23456')).toBe(false)   // 5 chars
    expect(isWellFormedCode('2345678')).toBe(false) // 7 chars
    expect(isWellFormedCode('2345O7')).toBe(false)  // contains O
    expect(normalizeHandoverCode(' a b-c ')).toBe('ABC')
  })
})
