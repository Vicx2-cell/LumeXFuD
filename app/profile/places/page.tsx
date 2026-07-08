'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProfilePlacesPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/profile/locations')
  }, [router])

  return (
    <div className="lx-page px-4 py-8">
      <p className="text-sm text-white/45">Redirecting...</p>
    </div>
  )
}
