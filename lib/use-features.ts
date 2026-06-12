'use client'

import { useEffect, useState } from 'react'

// Client-side reader for the public feature flags. Used to HIDE features in the
// UI when a super admin turns them off. Server-side enforcement still lives in
// the relevant routes — this is presentation only.

export type Features = Record<string, boolean>

// Optimistic defaults (everything on) so nothing flickers away before the
// flags load; once /api/features resolves, disabled features disappear.
// phone_verification defaults true so the sign-up OTP step shows until flags
// load — fail-safe, never skip verification just because the fetch is slow.
const DEFAULTS: Features = {
  ordering: true, signups: true, wallet: true, leaderboard: true, face_id: true,
  phone_verification: true,
}

let cache: Features | null = null
let inflight: Promise<Features> | null = null

function load(): Promise<Features> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch('/api/features')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { features?: Features } | null) => {
        cache = { ...DEFAULTS, ...(d?.features ?? {}) }
        return cache
      })
      .catch(() => ({ ...DEFAULTS }))
  }
  return inflight
}

export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>(cache ?? DEFAULTS)
  useEffect(() => {
    let active = true
    load().then((f) => { if (active) setFeatures(f) })
    return () => { active = false }
  }, [])
  return features
}
