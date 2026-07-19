'use client'

import { useState } from 'react'

export function ProfileFollowButton({ profileId, initialFollowing }: { profileId: string; initialFollowing: boolean }) {
  const [following, setFollowing] = useState(initialFollowing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function toggle() {
    if (busy) return
    const next = !following
    setFollowing(next)
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/feed/profiles/${profileId}/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update follow')
    } catch (cause) {
      setFollowing(!next)
      setError(cause instanceof Error ? cause.message : 'Could not update follow')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5">
      <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={following} className={`w-full rounded-full px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${following ? 'border border-white/12 bg-transparent text-white/80' : 'bg-[#f5a623] text-black'}`}>
        {busy ? 'Updating…' : following ? 'Following' : 'Follow'}
      </button>
      {error ? <p className="mt-2 text-center text-xs text-red-300">{error}</p> : null}
    </div>
  )
}
