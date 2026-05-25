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
    .select('id, name, description, price_kobo, image_url, category, is_available, daily_limit, sold_today, display_order')
    .eq('vendor_id', id)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })

  return (
    <main className="min-h-dvh pb-32" style={{ background: '#0A0A0B' }}>
      <VendorMenuClient vendor={vendor as VendorInfo} menu={(menu ?? []) as MenuItem[]} />
      <BottomNav />
    </main>
  )
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
  daily_limit: number | null
  sold_today: number
  display_order: number
}
