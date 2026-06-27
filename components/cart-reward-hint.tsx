'use client'

import { useEffect, useState } from 'react'
import { formatPrice } from '@/lib/money'

// Honest pre-payment hint: tells the customer they have reward credit that will
// be applied at checkout (the exact discount is resolved server-side at order
// creation — capped at the platform fee + delivery — so the Paystack charge is
// LOWER than the cart total shown above). Under-promises; never a fake countdown.
export function CartRewardHint() {
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
    <div className="lx-card-amber-soft rounded-2xl px-4 py-3 flex items-center gap-3">
      <span className="text-xl" aria-hidden="true">🎁</span>
      <p className="text-xs text-white/70 leading-relaxed">
        You have <span className="lx-amber font-semibold tabular-nums">{formatPrice(kobo)}</span> in rewards.
        We’ll apply it automatically — you’ll pay less than the total above at checkout.
      </p>
    </div>
  )
}
