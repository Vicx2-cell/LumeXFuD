import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getControls } from '@/lib/controls'
import { getPlatformFees, allInKobo, type PlatformFees } from './pricing'

// Live data for the data-driven guides. Each helper degrades to an honest empty
// result (never fabricated listings) so a guide stays truthful when data is thin.

export interface OpenLateVendor {
  slug: string
  shopName: string
  closingTime: string // 'HH:MM'
}

export interface OpenLateData {
  vendors: OpenLateVendor[]
  platformClose: string // platform closing time 'HH:MM' from controls
}

// "Open late" = a vendor whose own closing time is 21:00 or later. String compare
// works on zero-padded HH:MM. Only active, listed (slug present) vendors.
export async function getOpenLateVendors(): Promise<OpenLateData> {
  const controls = await getControls()
  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('vendors')
      .select('slug, shop_name, closing_time')
      .eq('is_active', true)
      .is('deleted_at', null)
      .not('slug', 'is', null)
      .not('closing_time', 'is', null)
      .gte('closing_time', '21:00')
      .order('closing_time', { ascending: false })
    const vendors: OpenLateVendor[] = (data ?? [])
      .filter((v) => v.slug && v.closing_time)
      .map((v) => ({ slug: v.slug as string, shopName: v.shop_name as string, closingTime: v.closing_time as string }))
    return { vendors, platformClose: controls.hours_close }
  } catch {
    return { vendors: [], platformClose: controls.hours_close }
  }
}

export interface BudgetSnapshot {
  fees: PlatformFees
  /** null when there are no available items to draw from. */
  prices: {
    itemCount: number
    vendorCount: number
    minItemKobo: number
    medianItemKobo: number
    minAllInKobo: number   // cheapest single item, all-in (item + markup + bike)
  } | null
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

// Real platform-wide price floor/median across AVAILABLE items at active vendors.
export async function getBudgetSnapshot(): Promise<BudgetSnapshot> {
  const fees = await getPlatformFees()
  try {
    const db = createSupabaseAdmin()
    const { data: vendors } = await db
      .from('vendors')
      .select('id')
      .eq('is_active', true)
      .is('deleted_at', null)
    const ids = (vendors ?? []).map((v) => v.id as string)
    if (ids.length === 0) return { fees, prices: null }

    const { data: items } = await db
      .from('menu_items')
      .select('price_kobo')
      .in('vendor_id', ids)
      .eq('is_available', true)
      .is('deleted_at', null)
    const prices = (items ?? []).map((i) => Number(i.price_kobo)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    if (prices.length === 0) return { fees, prices: null }

    return {
      fees,
      prices: {
        itemCount: prices.length,
        vendorCount: ids.length,
        minItemKobo: prices[0],
        medianItemKobo: median(prices),
        minAllInKobo: allInKobo(prices[0], fees),
      },
    }
  } catch {
    return { fees, prices: null }
  }
}
