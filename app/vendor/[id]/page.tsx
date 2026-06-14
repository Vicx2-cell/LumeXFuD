import { notFound } from 'next/navigation'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BottomNav } from '@/components/nav-bottom'
import { VendorMenuClient } from './vendor-menu-client'

export const revalidate = 60

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createSupabaseAdmin()

  const { data: vendor } = await db
    .from('vendors')
    .select(`
      id, shop_name, owner_name, logo_url, shop_photo_url,
      prep_time_minutes, status, paused_until, category, description,
      avg_rating, total_ratings, is_active
    `)
    .eq('id', id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single()

  if (!vendor) notFound()

  const { data: menu } = await db
    .from('menu_items')
    .select('id, name, description, price_kobo, image_url, category, is_available, prep_time_minutes, daily_limit, sold_today, display_order')
    .eq('vendor_id', id)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })

  const baseItems = (menu ?? []) as Omit<MenuItem, 'addons'>[]

  // Attach available add-ons per item. (Degrades gracefully to none if migration
  // 020 hasn't been run yet — the query just returns no rows.)
  const itemIds = baseItems.map((i) => i.id)
  const byItem = new Map<string, MenuAddon[]>()
  if (itemIds.length > 0) {
    const { data: addonRows } = await db
      .from('menu_item_addons')
      .select('id, menu_item_id, name, price_kobo')
      .in('menu_item_id', itemIds)
      .eq('is_available', true)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
    for (const a of (addonRows ?? []) as Array<MenuAddon & { menu_item_id: string }>) {
      const arr = byItem.get(a.menu_item_id) ?? []
      arr.push({ id: a.id, name: a.name, price_kobo: a.price_kobo })
      byItem.set(a.menu_item_id, arr)
    }
  }
  const menuWithAddons: MenuItem[] = baseItems.map((i) => ({ ...i, addons: byItem.get(i.id) ?? [] }))

  return (
    <main className="lx-page pb-32">
      <VendorMenuClient vendor={vendor as VendorInfo} menu={menuWithAddons} />
      <BottomNav />
    </main>
  )
}

export interface MenuAddon {
  id: string
  name: string
  price_kobo: number
}

export interface VendorInfo {
  id: string
  shop_name: string
  owner_name: string
  logo_url: string | null
  shop_photo_url: string | null
  prep_time_minutes: number
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  paused_until: string | null
  category: string
  description: string | null
  avg_rating: number
  total_ratings: number
}

export interface MenuItem {
  id: string
  name: string
  description: string | null
  price_kobo: number
  image_url: string | null
  category: string
  is_available: boolean
  prep_time_minutes: number | null
  daily_limit: number | null
  sold_today: number
  display_order: number
  addons: MenuAddon[]
}
