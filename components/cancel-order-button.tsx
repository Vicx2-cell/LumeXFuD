'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// "Cancel order" — only offered while the vendor hasn't accepted yet (the server
// enforces the same). Lives inside the order card's <Link>, so it must stop the
// click from also navigating to the order page.
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function cancel(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    if (!confirm('Cancel this order? You’ll be refunded in full. This can’t be undone.')) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMsg(data.error ?? 'Could not cancel')
        setBusy(false)
        return
      }
      router.refresh()
    } catch {
      setMsg('Network error — try again')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={cancel}
      disabled={busy}
      className="text-xs font-medium transition-opacity active:opacity-60 disabled:opacity-50"
      style={{ color: '#f87171' }}
    >
      {busy ? 'Cancelling…' : msg ? msg : '✕ Cancel order — full refund'}
    </button>
  )
}
