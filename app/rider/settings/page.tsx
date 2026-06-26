import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'
import { RiderSettings } from './settings-client'

export const dynamic = 'force-dynamic'

// Consolidated rider account/settings — identity, security, payout and
// verification in one organised place (grouped like the vendor settings).
export default async function RiderSettingsPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'rider') redirect('/auth?next=/rider/settings')

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, full_name, avatar_url, total_deliveries, avg_rating')
    .eq('id', session.userId)
    .single()

  if (!rider) redirect('/rider')

  return (
    <div className="lx-page lx-console pb-20 overflow-hidden">
      <GlassSheen />
      <div className="max-w-lg mx-auto px-4 py-7">
        <PageHeader title="Account & settings" subtitle="Your profile, security, payout and verification — all in one place." />
        <RiderSettings rider={rider as RiderSettable} />
      </div>
    </div>
  )
}

export interface RiderSettable {
  id: string
  full_name: string
  avatar_url: string | null
  total_deliveries: number
  avg_rating: number | null
}
