import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'
import { VendorSettings } from '../settings/settings-client'

export const dynamic = 'force-dynamic'

export default async function VendorStorePage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') redirect('/auth?next=/vendor-dashboard/store')

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, status, shop_photo_url, logo_url, opening_time, closing_time, pickup_enabled, pickup_max_concurrent, address_text, landmark, latitude, longitude, location_photo_url')
    .eq('id', session.userId)
    .single()

  if (!vendor) redirect('/vendor-dashboard')

  return (
    <div className="lx-page lx-console overflow-hidden pb-20">
      <GlassSheen />
      <div className="mx-auto max-w-lg px-4 py-7">
        <PageHeader
          title="Store"
          subtitle={`${(vendor as StoreVendor).shop_name} - profile, hours, delivery area, and open/close control.`}
          badge="Vendor"
        />
        <VendorSettings vendor={vendor as StoreVendor} showManageLinks={false} showAccount={false} />
      </div>
    </div>
  )
}

export interface StoreVendor {
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
