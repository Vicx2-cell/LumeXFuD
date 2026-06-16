import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { SentinelClient } from './sentinel-client'

export default async function SentinelPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'super_admin') redirect('/auth')

  return (
    <main className="min-h-dvh px-4 py-6" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">
        <SentinelClient />
      </div>
    </main>
  )
}
