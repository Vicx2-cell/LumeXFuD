import { describe, expect, it } from 'vitest'
import { validateMenuAddonSelection, type MenuAddonChoice } from '@/lib/menu-addon-selection'

const itemId = '11111111-1111-4111-8111-111111111111'
const choices: MenuAddonChoice[] = [
  { id: 'required-a', menu_item_id: itemId, name: 'Regular', price_kobo: 0, is_available: true, is_required: true },
  { id: 'required-b', menu_item_id: itemId, name: 'Large', price_kobo: 50000, is_available: true, is_required: true },
  { id: 'optional', menu_item_id: itemId, name: 'Plantain', price_kobo: 30000, is_available: true, is_required: false },
  { id: 'sold-out', menu_item_id: itemId, name: 'Turkey', price_kobo: 70000, is_available: false, is_required: false },
]

describe('menu add-on selection', () => {
  it('requires exactly one required choice', () => {
    expect(validateMenuAddonSelection(choices, []).error).toBe('Choose exactly one required option')
    expect(validateMenuAddonSelection(choices, ['required-a', 'required-b']).error).toBe('Choose exactly one required option')
  })

  it('accepts one required choice with optional add-ons', () => {
    const result = validateMenuAddonSelection(choices, ['required-a', 'optional'])
    expect(result.error).toBeNull()
    expect(result.selected.map((choice) => choice.id)).toEqual(['required-a', 'optional'])
  })

  it('rejects duplicate and unavailable selections', () => {
    expect(validateMenuAddonSelection(choices, ['required-a', 'required-a']).error).toMatch(/more than once/i)
    expect(validateMenuAddonSelection(choices, ['required-a', 'sold-out']).error).toMatch(/unavailable/i)
  })
})
