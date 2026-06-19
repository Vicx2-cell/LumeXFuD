'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface MineGroup { code: string; vendor_name: string; is_host: boolean; expires_at: string }

// Persistent "you're in a group order" banner. Mounted on the home page so a
// customer can always jump back into an active group, even after leaving the
// site and logging back in. Renders nothing when there are none.
export default function ActiveGroupBanner() {
  const router = useRouter()
  const [groups, setGroups] = useState<MineGroup[]>([])

  useEffect(() => {
    let alive = true
    fetch('/api/group-order/mine', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => { if (alive) setGroups(d.groups ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (groups.length === 0) return null

  // One slim one-line pill per active group, so each is tappable but compact.
  return (
    <div className="space-y-1.5">
      {groups.map((g) => (
        <button
          key={g.code}
          onClick={() => router.push(`/group/${g.code}`)}
          className="w-full flex items-center justify-between gap-2 rounded-full px-3.5 py-2 text-left"
          style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.3)' }}
        >
          <span className="text-sm text-white/85 truncate">
            👥 {g.vendor_name}{g.is_host ? ' · you host' : ''}
          </span>
          <span className="text-xs font-semibold shrink-0" style={{ color: '#F5A623' }}>Open →</span>
        </button>
      ))}
    </div>
  )
}
