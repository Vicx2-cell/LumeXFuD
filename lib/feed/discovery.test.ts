import { describe, expect, it } from 'vitest'
import { getCampusDeals, getFeaturedVendors, getTrendingTopics } from './discovery'

describe('feed discovery helpers', () => {
  const items = [
    {
      authorDisplayName: 'Chines Kitchen',
      authorHandle: 'chineskitchen',
      hashtags: ['campusfood', '#studentdeals'],
      postKind: 'MENU_ITEM',
      body: 'Goat meat basmati',
      menuItems: [{ name: 'Goat meat basmati', priceKobo: 380000, isPrimary: true }],
    },
    {
      authorDisplayName: 'Buka Joint',
      authorHandle: 'bukajoint',
      hashtags: ['campusfood', 'deal'],
      postKind: 'PROMOTION',
      body: 'Weekend promo',
      menuItems: [{ name: 'Jollof & chicken', priceKobo: 250000, isPrimary: true }],
    },
    {
      authorDisplayName: 'Chines Kitchen',
      authorHandle: 'chineskitchen',
      hashtags: ['campusfood'],
      postKind: 'TEXT',
    },
  ]

  it('builds trending topics from hashtags', () => {
    expect(getTrendingTopics(items, 3)).toEqual([
      { label: '#campusfood', count: 3 },
      { label: '#studentdeals', count: 1 },
      { label: '#deal', count: 1 },
    ])
  })

  it('aggregates featured vendors by post count', () => {
    expect(getFeaturedVendors(items, 2)).toEqual([
      { name: 'Chines Kitchen', handle: 'chineskitchen', count: 2 },
      { name: 'Buka Joint', handle: 'bukajoint', count: 1 },
    ])
  })

  it('builds campus deal cards from menu-linked posts', () => {
    expect(getCampusDeals(items, 2)).toEqual([
      { title: 'Goat meat basmati', vendor: 'Chines Kitchen', priceLabel: '₦3,800', badge: 'Menu item' },
      { title: 'Jollof & chicken', vendor: 'Buka Joint', priceLabel: '₦2,500', badge: 'Deal' },
    ])
  })
})
