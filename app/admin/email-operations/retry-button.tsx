'use client'

import { useState } from 'react'

export function RetryButton({ eventId }: { eventId: string }) {
  const [state, setState] = useState('Retry')
  return <button className="rounded-lg border border-white/15 px-3 py-2 text-xs" disabled={state !== 'Retry'} onClick={async () => {
    setState('Retrying…')
    const response = await fetch('/api/admin/email-operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId }) })
    setState(response.ok ? 'Requested' : 'Failed')
    if (response.ok) window.location.reload()
  }}>{state}</button>
}
