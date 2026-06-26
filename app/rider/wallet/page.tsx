import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import WalletView from '@/components/wallet/WalletView'
import { RiderAssistant } from '@/components/rider-assistant'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'

export default async function RiderWalletPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'rider') redirect('/auth')

  return (
    <main className="lx-page lx-console overflow-hidden">
      <GlassSheen />
      <div className="max-w-lg mx-auto px-4 pt-6">
        <PageHeader title="My Wallet" />
      </div>
      <WalletView userType="RIDER" />
      <RiderAssistant />
    </main>
  )
}
