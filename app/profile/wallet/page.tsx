import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { isCustomerWalletEnabled } from '@/lib/customer-wallet'
import CustomerWalletClient from './wallet-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'LumeX Wallet' }

export default async function CustomerWalletPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') redirect('/auth?next=/profile/wallet')

  // Kill switch: the customer wallet has no page when disabled — bounce home.
  if (!(await isCustomerWalletEnabled())) redirect('/home')

  return <CustomerWalletClient />
}
