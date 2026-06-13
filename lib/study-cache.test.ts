import { describe, it, expect, vi } from 'vitest'
import { normalizeConcept, cacheKey, withCache, type CacheIO } from './study-cache'

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

describe('withCache', () => {
  it('serves a HIT without calling generate', async () => {
    const io: CacheIO<{ text: string }> = {
      get: vi.fn(async () => ({ text: 'cached' })),
      set: vi.fn(async () => {}),
    }
    const generate = vi.fn(async () => ({ payload: { text: 'fresh' }, model: 'haiku' }))

    const res = await withCache('BCH 201', 'ask', 'glycolysis', io, generate)

    expect(res).toEqual({ payload: { text: 'cached' }, cached: true })
    expect(generate).not.toHaveBeenCalled()
    expect(io.set).not.toHaveBeenCalled()
  })

  it('on a MISS generates once and stores under the cache key', async () => {
    const store = new Map<string, { text: string }>()
    const io: CacheIO<{ text: string }> = {
      get: vi.fn(async (k) => store.get(k) ?? null),
      set: vi.fn(async (k, payload) => {
        store.set(k, payload)
      }),
    }
    const generate = vi.fn(async () => ({ payload: { text: 'fresh' }, model: 'haiku' }))

    const res = await withCache('BCH 201', 'ask', 'glycolysis', io, generate)

    expect(res).toEqual({ payload: { text: 'fresh' }, cached: false })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(io.set).toHaveBeenCalledWith(cacheKey('BCH 201', 'ask', 'glycolysis'), { text: 'fresh' }, 'haiku')
  })

  it('a second equivalent request HITs the now-warm cache (no second generate)', async () => {
    const store = new Map<string, unknown>()
    const io: CacheIO<unknown> = {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, payload) => {
        store.set(k, payload)
      },
    }
    const generate = vi.fn(async () => ({ payload: { n: 1 }, model: null }))

    await withCache('CHM 213', 'practice', 'Titration!', io, generate)
    // Same concept, different punctuation/case → same key → cache hit.
    const second = await withCache('chm 213', 'practice', '  titration ', io, generate)

    expect(second.cached).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
