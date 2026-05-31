import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import WalletView from '@/components/wallet/WalletView'

export default async function VendorEarningsPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') redirect('/auth')

  return (
    <main className="min-h-screen bg-[#0A0A0B]">
      <div className="sticky top-0 z-10 bg-[#0A0A0B]/90 backdrop-blur border-b border-white/10 px-4 py-4">
        <h1 className="text-white font-semibold text-lg">Earnings &amp; Wallet</h1>
      </div>
      <WalletView userType="VENDOR" />
    </main>
  )
}
