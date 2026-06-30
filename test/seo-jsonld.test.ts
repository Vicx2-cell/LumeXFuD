import { describe, it, expect } from 'vitest'
import { buildVendorJsonLd, buildGuideJsonLd } from '@/lib/seo/jsonld'
import { slugify } from '@/lib/seo/slug'
import type { SeoVendor } from '@/lib/seo/vendor-data'

const FEES = { platformMarkupKobo: 25000, bikeFeeKobo: 50000, doorFeeKobo: 100000, minOrderKobo: 50000 }

function makeVendor(over: Partial<SeoVendor> = {}): SeoVendor {
  return {
    id: 'v1', slug: 'mama-blessing-kitchen', shopName: "Mama Blessing's Kitchen",
    description: 'Home-style jollof and swallow.', category: 'Rice & Swallow',
    logoUrl: null, shopPhotoUrl: 'https://x.supabase.co/storage/v1/object/public/p.jpg',
    prepTimeMinutes: 20, status: 'OPEN', openingTime: '08:00', closingTime: '21:00',
    avgRating: 0, totalRatings: 0, kycVerified: true, updatedAt: '2026-06-30T00:00:00Z',
    menu: [
      { id: 'm1', name: 'Jollof Rice', description: 'Smoky party jollof', priceKobo: 120000, imageUrl: null, category: 'RICE', isAvailable: true },
      { id: 'm2', name: 'Coke', description: null, priceKobo: 30000, imageUrl: null, category: 'DRINKS', isAvailable: true },
    ],
    availableCount: 2,
    priceStats: { minKobo: 30000, medianKobo: 75000, maxKobo: 120000, cheapest: { id: 'm2', name: 'Coke', description: null, priceKobo: 30000, imageUrl: null, category: 'DRINKS', isAvailable: true } },
    reviews: [],
    open: { isOpen: true, reason: 'OPEN', label: 'Open now', hoursLabel: '8am – 9pm' },
    fees: FEES,
    areasServed: ['Chinaza Lodge', 'Peace Lodge'],
    deliveryWindow: { minMinutes: 30, maxMinutes: 35 },
    ...over,
  }
}

describe('buildVendorJsonLd', () => {
  it('emits a Restaurant with all-in menu prices (item + markup + bike fee)', () => {
    const ld = buildVendorJsonLd(makeVendor())
    const restaurant = ld['@graph'].find((g) => g['@type'] === 'Restaurant') as Record<string, unknown>
    expect(restaurant.name).toBe("Mama Blessing's Kitchen")
    const menu = restaurant.hasMenu as { hasMenuSection: Array<{ hasMenuItem: Array<{ name: string; offers: { price: string } }> }> }
    const jollof = menu.hasMenuSection.flatMap((s) => s.hasMenuItem).find((i) => i.name === 'Jollof Rice')!
    // 1200 item + 250 markup + 500 delivery = 1950.00
    expect(jollof.offers.price).toBe('1950.00')
  })

  it('emits OpeningHoursSpecification when hours are set', () => {
    const ld = buildVendorJsonLd(makeVendor())
    const restaurant = ld['@graph'].find((g) => g['@type'] === 'Restaurant') as Record<string, unknown>
    expect((restaurant.openingHoursSpecification as { opens: string }).opens).toBe('08:00')
  })

  it('GUARDRAIL: NEVER emits rating/review schema when there are no ratings', () => {
    const ld = buildVendorJsonLd(makeVendor({ totalRatings: 0, avgRating: 0, reviews: [] }))
    const restaurant = ld['@graph'].find((g) => g['@type'] === 'Restaurant') as Record<string, unknown>
    expect(restaurant.aggregateRating).toBeUndefined()
    expect(restaurant.review).toBeUndefined()
  })

  it('emits AggregateRating + Review only when real ratings exist', () => {
    const ld = buildVendorJsonLd(makeVendor({
      totalRatings: 3, avgRating: 4.67,
      reviews: [{ id: 'r1', stars: 5, review: 'Hot and fast!', createdAt: '2026-06-20T00:00:00Z' }],
    }))
    const restaurant = ld['@graph'].find((g) => g['@type'] === 'Restaurant') as Record<string, unknown>
    expect((restaurant.aggregateRating as { reviewCount: number }).reviewCount).toBe(3)
    expect((restaurant.review as unknown[]).length).toBe(1)
  })

  it('omits hours spec when the vendor has not set hours', () => {
    const ld = buildVendorJsonLd(makeVendor({ openingTime: null, closingTime: null }))
    const restaurant = ld['@graph'].find((g) => g['@type'] === 'Restaurant') as Record<string, unknown>
    expect(restaurant.openingHoursSpecification).toBeUndefined()
  })
})

describe('buildGuideJsonLd', () => {
  const base = { slug: 'how-escrow-protects-you-on-lumexfud', title: 'How escrow protects you', description: 'desc', updated: '2026-06-30' }

  it('always emits Article + BreadcrumbList', () => {
    const ld = buildGuideJsonLd({ ...base, faq: [] })
    const types = ld['@graph'].map((g) => g['@type'])
    expect(types).toContain('Article')
    expect(types).toContain('BreadcrumbList')
  })

  it('GUARDRAIL: omits FAQPage entirely when there are no Q&A items', () => {
    const ld = buildGuideJsonLd({ ...base, faq: [] })
    expect(ld['@graph'].some((g) => g['@type'] === 'FAQPage')).toBe(false)
  })

  it('emits FAQPage with each real Q&A when present', () => {
    const ld = buildGuideJsonLd({ ...base, faq: [
      { question: 'Who holds my money?', answer: 'LumeX does until delivery.' },
      { question: 'How do I pay?', answer: 'Paystack — card, transfer or USSD.' },
    ] })
    const faq = ld['@graph'].find((g) => g['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> }
    expect(faq.mainEntity.length).toBe(2)
    expect(faq.mainEntity[0].name).toBe('Who holds my money?')
    expect(faq.mainEntity[0].acceptedAnswer.text).toContain('LumeX')
  })
})

describe('slugify (mirrors SQL lx_slugify)', () => {
  it('lowercases, hyphenates, collapses and trims', () => {
    expect(slugify("Mama Blessing's Kitchen")).toBe('mama-blessing-s-kitchen')
    expect(slugify('  Hot & Spicy!!  ')).toBe('hot-spicy')
    expect(slugify('®©')).toBe('vendor')
  })
})
