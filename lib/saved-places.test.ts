import { describe, it, expect } from 'vitest'
import {
  cleanPlaceFields,
  canAddPlace,
  sortPlaces,
  pickUsual,
  placeToAddress,
  photoPathBelongsTo,
  MAX_SAVED_PLACES,
  LABEL_MAX,
  LANDMARK_MAX,
  type SavedPlace,
} from './saved-places'

function place(over: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'p1',
    label: 'Home',
    landmark: null,
    latitude: null,
    longitude: null,
    photo_path: null,
    is_default: false,
    use_count: 0,
    last_used_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

describe('cleanPlaceFields', () => {
  it('trims the label and accepts a bare label', () => {
    const r = cleanPlaceFields({ label: '  My Lodge  ' })
    expect(r).toEqual({ ok: true, value: { label: 'My Lodge', landmark: null, latitude: null, longitude: null } })
  })

  it('rejects an empty or whitespace-only label', () => {
    expect(cleanPlaceFields({ label: '   ' })).toEqual({ ok: false, error: expect.stringMatching(/required/i) })
    expect(cleanPlaceFields({})).toEqual({ ok: false, error: expect.stringMatching(/required/i) })
  })

  it('rejects an over-long label / landmark', () => {
    expect(cleanPlaceFields({ label: 'x'.repeat(LABEL_MAX + 1) }).ok).toBe(false)
    expect(cleanPlaceFields({ label: 'ok', landmark: 'y'.repeat(LANDMARK_MAX + 1) }).ok).toBe(false)
  })

  it('drops a blank landmark to null but keeps a real one trimmed', () => {
    expect(cleanPlaceFields({ label: 'a', landmark: '   ' })).toMatchObject({ ok: true, value: { landmark: null } })
    expect(cleanPlaceFields({ label: 'a', landmark: '  Behind gate ' })).toMatchObject({ ok: true, value: { landmark: 'Behind gate' } })
  })

  it('accepts a full pin and coerces string coords', () => {
    expect(cleanPlaceFields({ label: 'a', latitude: '5.6264', longitude: '7.4707' }))
      .toMatchObject({ ok: true, value: { latitude: 5.6264, longitude: 7.4707 } })
  })

  it('rejects a half pin (lat without lng)', () => {
    expect(cleanPlaceFields({ label: 'a', latitude: 5.6 }).ok).toBe(false)
    expect(cleanPlaceFields({ label: 'a', longitude: 7.4 }).ok).toBe(false)
  })

  it('rejects non-numeric and out-of-range coords', () => {
    expect(cleanPlaceFields({ label: 'a', latitude: 'abc', longitude: '1' }).ok).toBe(false)
    expect(cleanPlaceFields({ label: 'a', latitude: 91, longitude: 0 }).ok).toBe(false)
    expect(cleanPlaceFields({ label: 'a', latitude: 0, longitude: 181 }).ok).toBe(false)
  })

  it('treats empty-string coords as "no pin"', () => {
    expect(cleanPlaceFields({ label: 'a', latitude: '', longitude: '' }))
      .toMatchObject({ ok: true, value: { latitude: null, longitude: null } })
  })
})

describe('canAddPlace', () => {
  it('allows up to the cap and blocks at it', () => {
    expect(canAddPlace(0)).toBe(true)
    expect(canAddPlace(MAX_SAVED_PLACES - 1)).toBe(true)
    expect(canAddPlace(MAX_SAVED_PLACES)).toBe(false)
    expect(canAddPlace(MAX_SAVED_PLACES + 5)).toBe(false)
  })
})

describe('sortPlaces', () => {
  it('puts the default first regardless of usage', () => {
    const def = place({ id: 'def', is_default: true, use_count: 0 })
    const busy = place({ id: 'busy', use_count: 99 })
    expect(sortPlaces([busy, def])[0].id).toBe('def')
  })

  it('orders by use_count, then recency, then newest', () => {
    const a = place({ id: 'a', use_count: 5, last_used_at: '2026-06-10T00:00:00.000Z' })
    const b = place({ id: 'b', use_count: 5, last_used_at: '2026-06-20T00:00:00.000Z' })
    const c = place({ id: 'c', use_count: 1 })
    const d1 = place({ id: 'd', use_count: 0, created_at: '2026-06-05T00:00:00.000Z' })
    const e = place({ id: 'e', use_count: 0, created_at: '2026-06-01T00:00:00.000Z' })
    expect(sortPlaces([e, d1, c, a, b]).map((p) => p.id)).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('does not mutate the input', () => {
    const arr = [place({ id: 'a' }), place({ id: 'b', is_default: true })]
    const copy = [...arr]
    sortPlaces(arr)
    expect(arr).toEqual(copy)
  })
})

describe('pickUsual', () => {
  it('returns null for an empty list', () => {
    expect(pickUsual([])).toBeNull()
  })

  it('prefers the explicit default', () => {
    const def = place({ id: 'def', is_default: true, use_count: 0 })
    const busy = place({ id: 'busy', use_count: 50 })
    expect(pickUsual([busy, def])?.id).toBe('def')
  })

  it('falls back to the most-reused when no default', () => {
    const a = place({ id: 'a', use_count: 2 })
    const b = place({ id: 'b', use_count: 7 })
    expect(pickUsual([a, b])?.id).toBe('b')
  })
})

describe('placeToAddress', () => {
  it('joins label and landmark when present', () => {
    expect(placeToAddress({ label: 'Mum', landmark: 'Behind the gate' })).toBe('Mum — Behind the gate')
  })
  it('uses the label alone when no landmark', () => {
    expect(placeToAddress({ label: 'Hostel B', landmark: null })).toBe('Hostel B')
  })
})

describe('photoPathBelongsTo', () => {
  const me = 'cust-123'
  it('accepts a path inside the owner folder', () => {
    expect(photoPathBelongsTo('cust-123/abc.webp', me)).toBe(true)
  })
  it('rejects another owner folder', () => {
    expect(photoPathBelongsTo('cust-999/abc.webp', me)).toBe(false)
  })
  it('rejects a prefix-collision folder', () => {
    // "cust-1234" must not pass as "cust-123" — the slash boundary matters.
    expect(photoPathBelongsTo('cust-1234/abc.webp', me)).toBe(false)
  })
  it('rejects traversal and empties', () => {
    expect(photoPathBelongsTo('cust-123/../cust-999/x.webp', me)).toBe(false)
    expect(photoPathBelongsTo('', me)).toBe(false)
    expect(photoPathBelongsTo(undefined as unknown as string, me)).toBe(false)
  })
})
