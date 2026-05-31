import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import CustomerWalletClient from './wallet-client'

export const metadata = { title: 'LumeX Wallet' }

export default async function CustomerWalletPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') redirect('/auth?next=/profile/wallet')

  return <CustomerWalletClient />
}
