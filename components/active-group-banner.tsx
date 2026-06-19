'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface MineGroup { code: string; vendor_name: string; is_host: boolean; expires_at: string }

const CACHE_KEY = 'lx_active_groups'

// Persistent "you're in a group order" banner. Mounted on the home page so a
// customer can always jump back into an active group, even after leaving the
// site and logging back in. Renders nothing when there are none.
//
// Stale-while-revalidate: it hydrates instantly from the last known list (so it
// doesn't flash/disappear between page loads), then revalidates in the
// background. It only HIDES on a CONFIRMED empty response — a transient error or
// dropped request keeps the last good state, so it stops flickering.
export default function ActiveGroupBanner() {
  const router = useRouter()
  const [groups, setGroups] = useState<MineGroup[]>([])

  useEffect(() => {
    // Show the cached list immediately (avoids the empty-then-pop-in flicker).
    try {
      const c = sessionStorage.getItem(CACHE_KEY)
      if (c) setGroups(JSON.parse(c) as MineGroup[])
    } catch { /* ignore */ }

    let alive = true
    fetch('/api/group-order/mine', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return // error / non-OK → keep last good state, don't blank
        const g = (d.groups ?? []) as MineGroup[]
        setGroups(g)
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(g)) } catch { /* ignore */ }
      })
      .catch(() => { /* network error → keep cached */ })
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
