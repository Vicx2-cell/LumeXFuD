export interface GroupOrderAddonSnapshot {
  id: string
  name: string
  price_kobo: number
}

export interface GroupOrderPricedLine {
  price_kobo: number
  quantity: number
  addons?: GroupOrderAddonSnapshot[] | null
}

export function normalizeGroupOrderAddons(value: unknown): GroupOrderAddonSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { id?: unknown; name?: unknown; price_kobo?: unknown }
    const id = typeof row.id === 'string' ? row.id : ''
    const name = typeof row.name === 'string' ? row.name : ''
    const price = Number(row.price_kobo)
    if (!id || !name || !Number.isFinite(price) || price < 0) return []
    return [{ id, name, price_kobo: Math.round(price) }]
  })
}

export function groupOrderLineTotalKobo(line: GroupOrderPricedLine): number {
  const addonTotal = normalizeGroupOrderAddons(line.addons).reduce((sum, addon) => sum + addon.price_kobo, 0)
  return (line.price_kobo + addonTotal) * line.quantity
}

export function groupOrderAddonLabel(addons: readonly GroupOrderAddonSnapshot[]): string {
  return addons.length ? `+ ${addons.map((addon) => addon.name).join(', ')}` : ''
}

