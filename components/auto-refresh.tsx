'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const REFRESH_INTERVAL_MS = 3_000

export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      router.refresh()
    }

    const id = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [router])

  return null
}
