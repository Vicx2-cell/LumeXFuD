import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'
import { VendorSettings } from './settings-client'

export const dynamic = 'force-dynamic'

// Consolidated vendor Settings - everything settable about the store in one
// organised place (store appearance, hours, pickup, security) + quick links to
// the deeper areas, instead of scattering controls across the ops dashboard.
export default async function VendorSettingsPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') redirect('/auth?next=/vendor-dashboard/settings')

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, status, shop_photo_url, logo_url, opening_time, closing_time, pickup_enabled, pickup_max_concurrent, address_text, landmark, latitude, longitude, location_photo_url')
    .eq('id', session.userId)
    .single()

  if (!vendor) redirect('/vendor-dashboard')

  return (
    <div className="lx-page lx-console pb-20 overflow-hidden">
      <GlassSheen />
      <div className="max-w-lg mx-auto px-4 py-7">
        <PageHeader title="Settings" subtitle={`${(vendor as VendorSettable).shop_name} - everything about your store, in one place.`} />
        <VendorSettings vendor={vendor as VendorSettable} />
      </div>
    </div>
  )
}

export interface VendorSettable {
  id: string
  shop_name: string
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  shop_photo_url: string | null
  logo_url: string | null
  opening_time: string | null
  closing_time: string | null
  pickup_enabled: boolean
  pickup_max_concurrent: number
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  location_photo_url: string | null
}
