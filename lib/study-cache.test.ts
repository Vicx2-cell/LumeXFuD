import { describe, it, expect } from 'vitest'
import { normalizeConcept, cacheKey } from './study-cache'

describe('normalizeConcept', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeConcept('First Law of Thermodynamics!')).toBe('first law of thermodynamics')
    expect(normalizeConcept('  first   law  of\tthermodynamics ')).toBe('first law of thermodynamics')
  })

  it('does not glue words when punctuation is removed', () => {
    expect(normalizeConcept('acid-base balance')).toBe('acid base balance')
    expect(normalizeConcept('pH, buffers & titration')).toBe('ph buffers titration')
  })

  it('keeps digits and unicode letters', () => {
    expect(normalizeConcept('SN2 reaction')).toBe('sn2 reaction')
    expect(normalizeConcept('Protéine')).toBe('protéine')
  })
})

describe('cacheKey', () => {
  it('is a 64-char hex sha256 digest', () => {
    expect(cacheKey('BCH 201', 'ask', 'glycolysis')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('collides for concepts that normalise the same', () => {
    expect(cacheKey('BCH 201', 'ask', 'First Law of Thermodynamics!')).toBe(
      cacheKey('BCH 201', 'ask', '  first law of  thermodynamics '),
    )
  })

  it('collides for course codes that differ only by case/spacing', () => {
    expect(cacheKey('CHM 213', 'practice', 'titration')).toBe(cacheKey('chm  213', 'practice', 'titration'))
  })

  it('differs by kind, course, and concept', () => {
    const base = cacheKey('BCH 201', 'ask', 'glycolysis')
    expect(cacheKey('BCH 201', 'practice', 'glycolysis')).not.toBe(base)
    expect(cacheKey('BCH 202', 'ask', 'glycolysis')).not.toBe(base)
    expect(cacheKey('BCH 201', 'ask', 'gluconeogenesis')).not.toBe(base)
  })

  it('is deterministic across calls', () => {
    expect(cacheKey('PHY 101', 'ask', 'newton laws')).toBe(cacheKey('PHY 101', 'ask', 'newton laws'))
  })
})
