import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import WalletView from '@/components/wallet/WalletView'
import { VendorDailySummary } from '@/components/vendor-daily-summary'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'

export default async function VendorEarningsPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') redirect('/auth')

  return (
    <main className="lx-page lx-console min-h-screen overflow-hidden">
      <GlassSheen />
      <div className="max-w-lg mx-auto px-4 pt-6">
        <PageHeader title="Earnings & Wallet" />
      </div>
      <VendorDailySummary />
      <WalletView userType="VENDOR" />
    </main>
  )
}
