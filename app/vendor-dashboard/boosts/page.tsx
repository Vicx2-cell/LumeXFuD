import { redirect } from 'next/navigation'
import { getFeature } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function VendorBoostsPage() {
  if (!(await getFeature('post_boosts_enabled'))) {
    redirect('/vendor-dashboard')
  }
  redirect('/vendor-dashboard')
}
