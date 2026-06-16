'use client'

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'

// Client-side reader for the public feature flags. Used to HIDE features in the
// UI when a super admin turns them off. Server-side enforcement still lives in
// the relevant routes — this is presentation only.
//
// Flags are resolved ON THE SERVER (root layout → getAllFeatures) and injected
// via <FeaturesProvider initial={…}>. That means the server-rendered HTML
// already reflects the real flags, so a disabled feature is NEVER sent to the
// browser — no "appear then disappear" flash. The provider then refreshes once
// in the background so a toggle propagates without a hard reload.

export type Features = Record<string, boolean>

// Fallback for the rare component that renders outside the provider (and for
// SSR safety). Everything on, except nothing that would skip a security step —
// phone_verification defaults true so OTP shows until flags resolve.
const DEFAULTS: Features = {
  ordering: true, signups: true, wallet: true, leaderboard: true, face_id: true,
  phone_verification: true,
}

const FeaturesContext = createContext<Features | null>(null)

export function FeaturesProvider({ initial, children }: { initial: Features; children: ReactNode }) {
  const [features, setFeatures] = useState<Features>(initial)
  useEffect(() => {
    let active = true
    // Background refresh so a super-admin toggle takes effect without a reload.
    fetch('/api/features')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { features?: Features } | null) => {
        if (active && d?.features) setFeatures(d.features)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])
  return createElement(FeaturesContext.Provider, { value: features }, children)
}

export function useFeatures(): Features {
  return useContext(FeaturesContext) ?? DEFAULTS
}
