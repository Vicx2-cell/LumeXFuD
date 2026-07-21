import { describe, expect, it } from 'vitest'
import { groupOrderAddonLabel, groupOrderLineTotalKobo, normalizeGroupOrderAddons } from '@/lib/group-order-addons'

describe('group order add-on helpers', () => {
  it('normalizes only valid stored add-on snapshots', () => {
    expect(normalizeGroupOrderAddons([
      { id: 'a1', name: 'Extra meat', price_kobo: 30000 },
      { id: '', name: 'Bad', price_kobo: 100 },
      { id: 'a2', name: 'Bad price', price_kobo: -1 },
      null,
    ])).toEqual([{ id: 'a1', name: 'Extra meat', price_kobo: 30000 }])
  })

  it('includes add-ons in group line totals', () => {
    expect(groupOrderLineTotalKobo({
      price_kobo: 120000,
      quantity: 2,
      addons: [{ id: 'a1', name: 'Egg', price_kobo: 20000 }],
    })).toBe(280000)
  })

  it('builds a compact add-on label', () => {
    expect(groupOrderAddonLabel([
      { id: 'a1', name: 'Egg', price_kobo: 20000 },
      { id: 'a2', name: 'Plantain', price_kobo: 30000 },
    ])).toBe('+ Egg, Plantain')
  })
})

