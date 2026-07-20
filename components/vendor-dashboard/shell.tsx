'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Menu } from 'lucide-react'
import { VendorDashboardSidebar, VendorMobileBottomNav } from './sidebar'
import type { VendorDashboardRecentOrder, VendorDashboardSummary, VendorDashboardVendor } from './helpers'

type DashboardPayload = {
  vendor: VendorDashboardVendor
  summary: VendorDashboardSummary
  recent: VendorDashboardRecentOrder[]
  orders: Array<{ id: string; status: string }>
}

type VendorDashboardContextValue = DashboardPayload | null

const VendorDashboardContext = createContext<VendorDashboardContextValue>(null)

export function useVendorDashboard() {
  return useContext(VendorDashboardContext)
}

export function VendorDashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [vendor, setVendor] = useState<VendorDashboardVendor | null>(null)
  const [summary, setSummary] = useState<VendorDashboardSummary | null>(null)
  const [recent, setRecent] = useState<VendorDashboardRecentOrder[]>([])

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const res = await fetch('/api/vendor/orders')
        if (res.status === 401 || res.status === 403) {
          router.replace('/auth')
          return
        }
        if (!res.ok) return
        const data = await res.json() as DashboardPayload
        if (!alive) return
        setVendor(data.vendor)
        setSummary(data.summary)
        setRecent(data.recent ?? [])
      } catch {
        // Keep the shell usable even if the summary endpoint is temporarily unavailable.
      }
    })()

    return () => {
      alive = false
    }
  }, [router])

  const active = summary?.active_orders ?? 0
  const pending = summary?.pending_orders ?? 0
  const prep = summary?.preparing_orders ?? 0
  const ready = summary?.ready_orders ?? 0
  const payload = useMemo<DashboardPayload | null>(() => {
    if (!vendor || !summary) return null
    return {
      vendor,
      summary,
      recent,
      orders: [],
    }
  }, [recent, summary, vendor])

  return (
    <VendorDashboardContext.Provider value={payload}>
      <div className="min-h-dvh bg-[#09090B] lg:flex">
        <VendorDashboardSidebar
          vendor={vendor}
          open={open}
          counts={{ active, pending, prep, ready }}
          onClose={() => setOpen(false)}
        />
        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 border-b border-white/8 bg-black/75 px-4 py-3 backdrop-blur-xl lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
                aria-label="Open navigation"
              >
                <Menu size={18} />
              </button>
              <div className="min-w-0 text-right">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Vendor workspace</p>
                <p className="truncate text-sm font-medium text-white">{vendor?.shop_name ?? 'LumeX'}</p>
              </div>
            </div>
          </div>
          {children}
        </div>
        <VendorMobileBottomNav pending={pending} onMore={() => setOpen(true)} />
      </div>
    </VendorDashboardContext.Provider>
  )
}
