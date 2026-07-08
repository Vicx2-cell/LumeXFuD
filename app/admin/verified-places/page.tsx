'use client'
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { GlassSheen } from '@/components/fx'

interface VerifiedPlaceRow {
  id: string
  name: string
  canonical_latitude: number
  canonical_longitude: number
  city: string
  status: 'candidate' | 'verified' | 'rejected'
  confidence_count: number
  created_at: string
  updated_at: string
}

const STATUS_STYLES: Record<VerifiedPlaceRow['status'], { bg: string; color: string }> = {
  candidate: { bg: 'rgba(96,165,250,0.15)', color: '#60A5FA' },
  verified: { bg: 'rgba(34,197,94,0.15)', color: '#22C55E' },
  rejected: { bg: 'rgba(239,68,68,0.12)', color: '#EF4444' },
}

export default function AdminVerifiedPlacesPage() {
  const [places, setPlaces] = useState<VerifiedPlaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/admin/verified-places')
    if (res.ok) {
      const data = await res.json() as { places: VerifiedPlaceRow[] }
      setPlaces(data.places ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function setStatus(id: string, status: VerifiedPlaceRow['status']) {
    setBusyId(id + status)
    const res = await fetch(`/api/admin/verified-places/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) await load()
    setBusyId(null)
  }

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-4xl">
        <PageHeader title="Verified places" subtitle={`${places.length} entries`} badge="Admin" />

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl lx-skeleton" />)}
          </div>
        ) : places.length === 0 ? (
          <EmptyState title="No verified places yet" description="Delivered orders will gradually seed the verified-place list." />
        ) : (
          <div className="space-y-3">
            {places.map((place) => {
              const style = STATUS_STYLES[place.status]
              return (
                <div key={place.id} className="lx-surface rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-white truncate">{place.name}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: style.bg, color: style.color }}>
                          {place.status}
                        </span>
                      </div>
                      <p className="text-sm text-white/45 mt-0.5">
                        {place.city} · {place.confidence_count} confirmations
                      </p>
                      <p className="text-xs text-white/35 mt-2">
                        {place.canonical_latitude.toFixed(5)}, {place.canonical_longitude.toFixed(5)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {place.status !== 'verified' && (
                        <button
                          onClick={() => void setStatus(place.id, 'verified')}
                          disabled={busyId === place.id + 'verified'}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}
                        >
                          {busyId === place.id + 'verified' ? '…' : 'Verify'}
                        </button>
                      )}
                      {place.status !== 'rejected' && (
                        <button
                          onClick={() => void setStatus(place.id, 'rejected')}
                          disabled={busyId === place.id + 'rejected'}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
                        >
                          {busyId === place.id + 'rejected' ? '…' : 'Reject'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
