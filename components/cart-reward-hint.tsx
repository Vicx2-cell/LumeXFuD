'use client'

import { useEffect, useState } from 'react'
import { formatPrice } from '@/lib/money'

// Rewards are saved by default. Checkout only spends them when the customer
// explicitly opts in; the server still computes the exact discount safely.
export function CartRewardHint({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const [kobo, setKobo] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/rewards', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { credits?: { total_kobo?: number } } | null) => {
        if (alive && d?.credits?.total_kobo) setKobo(d.credits.total_kobo)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (kobo <= 0) return null
  return (
    <label className="lx-card-amber-soft rounded-2xl px-4 py-3 flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 accent-amber-400"
      />
      <span className="text-xl" aria-hidden="true">🎁</span>
      <span className="text-xs text-white/70 leading-relaxed">
        Use saved rewards now: <span className="lx-amber font-semibold tabular-nums">{formatPrice(kobo)}</span> available.
        Leave unchecked to save them for a later order.
      </span>
    </label>
  )
}
