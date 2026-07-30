import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'LumeX Wallet' }

export default function CustomerWalletPage() {
  redirect('/profile/virtual-account')
}
