'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { GlassSheen } from '@/components/fx'

interface LocationRow {
  id: string
  customer_id: string
  label: string
  latitude: number
  longitude: number
  delivery_note: string | null
  city_id: string | null
  zone_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  customers?: { name: string | null; phone: string } | null
}

export default function AdminCustomerLocationsPage() {
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const res = await fetch('/api/admin/customer-locations')
    if (res.ok) {
      const data = await res.json() as { locations: LocationRow[] }
      setLocations(data.locations ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-4xl">
        <PageHeader title="Customer locations" subtitle={`${locations.length} pins`} badge="Admin" />

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl lx-skeleton" />)}
          </div>
        ) : locations.length === 0 ? (
          <EmptyState title="No customer pins yet" description="Pins will appear after customers capture their current location." />
        ) : (
          <div className="space-y-3">
            {locations.map((row) => (
              <div key={row.id} className="lx-surface rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white truncate">{row.label}</p>
                      {row.is_active && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,166,35,0.16)', color: '#F5A623' }}>active</span>}
                    </div>
                    <p className="text-sm text-white/45 mt-0.5 truncate">
                      {row.customers?.name ?? 'Unknown customer'} · {row.customers?.phone ?? row.customer_id}
                    </p>
                    <p className="text-xs text-white/35 mt-2">
                      {row.delivery_note ?? '—'} · {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-xs text-white/35">
                    <p>{row.city_id ?? 'No city'}</p>
                    <p className="mt-0.5">{row.zone_id ?? 'No zone'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
