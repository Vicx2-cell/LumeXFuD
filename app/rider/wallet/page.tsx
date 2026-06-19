import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import WalletView from '@/components/wallet/WalletView'
import { RiderAssistant } from '@/components/rider-assistant'

export default async function RiderWalletPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'rider') redirect('/auth')

  return (
    <main className="lx-page">
      <div className="lx-topbar sticky top-0 z-10 px-4 py-4 flex items-center gap-3">
        <a
          href="/rider"
          className="w-8 h-8 flex items-center justify-center rounded-full text-white/50 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          ←
        </a>
        <h1 className="text-white font-semibold text-lg">My Wallet</h1>
      </div>
      <WalletView userType="RIDER" />
      <RiderAssistant />
    </main>
  )
}
