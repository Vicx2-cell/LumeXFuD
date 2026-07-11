'use client'

import { useState } from 'react'

type BillingCycle = 'monthly' | 'yearly'

type Props = {
  planKey: string
  monthlyPriceLabel: string
  yearlyPriceLabel: string
  premiumEnabled: boolean
  newSubscriptionsEnabled: boolean
}

export function PremiumPurchaseActions({
  planKey,
  monthlyPriceLabel,
  yearlyPriceLabel,
  premiumEnabled,
  newSubscriptionsEnabled,
}: Props) {
  const [busy, setBusy] = useState<BillingCycle | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(billing_cycle: BillingCycle) {
    setBusy(billing_cycle)
    setError(null)
    try {
      const res = await fetch('/api/premium/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_key: planKey, billing_cycle }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not start checkout')
      if (typeof data.authorization_url === 'string') {
        window.location.href = data.authorization_url
        return
      }
      throw new Error('Checkout URL missing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout')
    } finally {
      setBusy(null)
    }
  }

  const disabled = !premiumEnabled || !newSubscriptionsEnabled
  const disabledReason = !premiumEnabled
    ? 'Premium is globally disabled by admin.'
    : !newSubscriptionsEnabled
      ? 'New subscriptions are currently disabled.'
      : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => void startCheckout('monthly')}
          className="lx-btn-secondary px-3 py-2 text-xs disabled:opacity-50"
        >
          {busy === 'monthly' ? 'Opening checkout…' : `Pay monthly · ${monthlyPriceLabel}`}
        </button>
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => void startCheckout('yearly')}
          className="lx-btn-secondary px-3 py-2 text-xs disabled:opacity-50"
        >
          {busy === 'yearly' ? 'Opening checkout…' : `Pay yearly · ${yearlyPriceLabel}`}
        </button>
      </div>
      {disabledReason && <p className="text-xs text-white/45">{disabledReason}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
