import { createSupabaseAdmin } from './supabase/server'

export const DEFAULT_AFFORDABLE_THRESHOLDS_KOBO = [100_000, 150_000, 200_000, 300_000] as const
export const AFFORDABLE_THRESHOLDS_SETTING_ID = 'affordable_discovery_thresholds_kobo'

type DB = ReturnType<typeof createSupabaseAdmin>

export type DiscoverableItem = { id: string; vendorId: string; category: string | null; priceKobo: number; isAvailable: boolean }

export function affordableItems(items: DiscoverableItem[], ceilingKobo: number): DiscoverableItem[] {
  return items.filter((item) => item.isAvailable && Number.isInteger(item.priceKobo) && item.priceKobo > 0 && item.priceKobo <= ceilingKobo)
}

export function normalizeAffordableThresholds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_AFFORDABLE_THRESHOLDS_KOBO.length) return [...DEFAULT_AFFORDABLE_THRESHOLDS_KOBO]
  const thresholds = value.map(Number)
  if (thresholds.some((threshold) => !Number.isSafeInteger(threshold) || threshold <= 0) || thresholds.some((threshold, index) => index > 0 && threshold <= thresholds[index - 1])) {
    return [...DEFAULT_AFFORDABLE_THRESHOLDS_KOBO]
  }
  return thresholds
}

export async function getAffordableThresholdsKobo(db: DB = createSupabaseAdmin()): Promise<number[]> {
  const { data } = await db.from('settings').select('value').eq('id', AFFORDABLE_THRESHOLDS_SETTING_ID).maybeSingle()
  const value = (data as { value?: { values_kobo?: unknown } } | null)?.value?.values_kobo
  return normalizeAffordableThresholds(value)
}

/** Same vendor/category only, deterministic, and never an implicit cart write. */
export function recommendAddons(items: DiscoverableItem[], source: DiscoverableItem): DiscoverableItem[] {
  return items
    .filter((item) => item.isAvailable && item.vendorId === source.vendorId && item.id !== source.id && item.priceKobo > 0)
    .sort((a, b) => Number(a.category !== source.category) - Number(b.category !== source.category) || a.priceKobo - b.priceKobo || a.id.localeCompare(b.id))
    .slice(0, 3)
}
