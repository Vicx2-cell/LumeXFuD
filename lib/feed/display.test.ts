import { describe, expect, it } from 'vitest'
import { formatCompactCount, formatDiscountLabel, formatMenuItemPrice, formatOfficialFeedHeadline, pickPrimaryMenuItem, resolveFeedHeroMedia } from './display'

describe('feed display helpers', () => {
  it('prefers the primary menu item and its live image', () => {
    const menuItems = [
      { id: 'm-1', menuItemId: 'm-1', name: 'Rice', priceKobo: 250000, isAvailable: true, isPrimary: false, imageUrl: null },
      { id: 'm-2', menuItemId: 'm-2', name: 'Goat meat basmati', priceKobo: 380000, isAvailable: true, isPrimary: true, imageUrl: 'https://example.com/menu.jpg' },
    ]

    const primary = pickPrimaryMenuItem(menuItems)
    if (!primary) throw new Error('expected primary menu item')
    expect(primary?.name).toBe('Goat meat basmati')
    expect(formatMenuItemPrice(primary)).toBe('\u20A63,800')
    expect(formatMenuItemPrice({ ...primary, priceKobo: -1 })).toBeNull()

    const media = resolveFeedHeroMedia(
      {
        id: 'post-1',
        authorProfileId: 'profile-1',
        postKind: 'MENU_ITEM',
        status: 'published',
        visibility: 'public',
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        media: [{ id: 'media-1', kind: 'image', publicUrl: 'https://example.com/image.jpg' }],
      } as never,
      primary,
    )

    expect(media?.publicUrl).toBe('https://example.com/menu.jpg')
  })

  it('falls back cleanly when no hero image exists', () => {
    const media = resolveFeedHeroMedia(
      {
        id: 'post-2',
        authorProfileId: 'profile-2',
        postKind: 'TEXT',
        status: 'published',
        visibility: 'public',
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        media: [],
      } as never,
      null,
    )

    expect(media).toBeNull()
  })

  it('hides menu-linked hero media when the selected item has no image', () => {
    const media = resolveFeedHeroMedia(
      {
        id: 'post-3',
        authorProfileId: 'profile-3',
        postKind: 'MENU_ITEM',
        status: 'published',
        visibility: 'public',
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        media: [{ id: 'media-1', kind: 'image', publicUrl: 'https://example.com/image.jpg' }],
      } as never,
      { id: 'm-3', menuItemId: 'm-3', name: 'Soup', priceKobo: 120000, isAvailable: true, isPrimary: true, imageUrl: null },
    )

    expect(media).toBeNull()
  })

  it('rejects invalid old-price discounts', () => {
    expect(formatDiscountLabel(380000, 380000)).toBeNull()
    expect(formatDiscountLabel(380000, 300000)).toBeNull()
    expect(formatDiscountLabel(380000, 0)).toBeNull()
  })

  it('formats compact counts for social UI', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(12)).toBe('12')
    expect(formatCompactCount(1200)).toBe('1.2K')
    expect(formatCompactCount(15000)).toBe('15K')
  })

  it('humanizes official feed headlines without corporate copy', () => {
    expect(formatOfficialFeedHeadline('evening_collection')).toBe('Late-night picks')
    expect(formatOfficialFeedHeadline('student_budget')).toBe('Meals under budget')
    expect(formatOfficialFeedHeadline('new_on_lumex')).toBe('New on LumeX')
  })
})
