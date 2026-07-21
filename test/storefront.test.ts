import { describe, expect, it } from 'vitest'
import { isReservedStoreSlug, normalizeStoreSlug, storePath } from '@/lib/storefront'

describe('storefront slug helpers', () => {
  it('normalizes punctuation, spacing, and unicode safely', () => {
    expect(normalizeStoreSlug('  Mama Blessing!!!  ')).toBe('mama-blessing')
    expect(normalizeStoreSlug('caf%C3%A9 rice')).toBe('caf-rice')
    expect(normalizeStoreSlug('%C2%AE%C2%A9')).toBe('vendor')
    expect(normalizeStoreSlug('%E0%A4%A')).toBe('vendor')
  })

  it('rejects reserved platform words', () => {
    expect(isReservedStoreSlug('admin')).toBe(true)
    expect(isReservedStoreSlug(' Vendor ')).toBe(true)
    expect(isReservedStoreSlug('mama-blessing')).toBe(false)
  })

  it('builds canonical commerce storefront paths', () => {
    expect(storePath("Mama's Kitchen")).toBe('/store/mama-s-kitchen')
  })
})
