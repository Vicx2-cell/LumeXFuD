'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'

const REFRESH_INTERVAL_MS = 12_000
const LIVE_PREFIXES = ['/home', '/feed-v2', '/orders', '/leaderboard', '/vendor-dashboard', '/rider']

export function AutoRefresh() {
  const router = useRouter()
  const pathname = usePathname()

  const isLiveSurface = LIVE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  useEffect(() => {
    if (!isLiveSurface) return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      router.refresh()
    }

    const id = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [isLiveSurface, router])

  return null
}
