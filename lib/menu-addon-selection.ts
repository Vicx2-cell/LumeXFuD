export interface MenuAddonChoice {
  id: string
  menu_item_id: string
  name: string
  price_kobo: number
  is_available: boolean
  is_required: boolean
}

export interface MenuAddonSelectionResult {
  error: string | null
  selected: MenuAddonChoice[]
}

export function validateMenuAddonSelection(
  addons: MenuAddonChoice[],
  selectedIds: string[],
): MenuAddonSelectionResult {
  const uniqueIds = new Set(selectedIds)
  if (uniqueIds.size !== selectedIds.length) {
    return { error: 'An option cannot be selected more than once', selected: [] }
  }

  const byId = new Map(addons.map((addon) => [addon.id, addon]))
  const selected: MenuAddonChoice[] = []
  for (const id of selectedIds) {
    const addon = byId.get(id)
    if (!addon || !addon.is_available) {
      return { error: 'One or more add-ons are invalid or unavailable', selected: [] }
    }
    selected.push(addon)
  }

  const requiredChoices = addons.filter((addon) => addon.is_available && addon.is_required)
  const requiredSelected = selected.filter((addon) => addon.is_required)
  if (requiredChoices.length > 0 && requiredSelected.length !== 1) {
    return { error: 'Choose exactly one required option', selected: [] }
  }

  return { error: null, selected }
}
