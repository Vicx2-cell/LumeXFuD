import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { GlassSheen } from '@/components/fx'
import { SentinelClient } from './sentinel-client'

export default async function SentinelPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'super_admin') redirect('/auth')

  return (
    <main className="lx-page lx-console px-4 py-6 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-2xl">
        <SentinelClient />
      </div>
    </main>
  )
}
