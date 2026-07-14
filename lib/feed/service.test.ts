import { describe, expect, it } from 'vitest'
import { shouldHidePromotionFromForYou } from './service'

describe('feed service tab filtering', () => {
  it('keeps promotions out of the For You tab', () => {
    expect(shouldHidePromotionFromForYou('for_you', 'PROMOTION')).toBe(true)
  })

  it('allows promotions on non-For You tabs', () => {
    expect(shouldHidePromotionFromForYou('deals', 'PROMOTION')).toBe(false)
    expect(shouldHidePromotionFromForYou('trending', 'TEXT')).toBe(false)
  })
})
