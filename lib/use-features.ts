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

// Fail-closed fallback for the rare component rendered outside the provider.
// Phone verification stays on because omitting that control would weaken
// signup; optional product capabilities stay hidden until server flags resolve.
const DEFAULTS: Features = {
  ordering: false,
  signups: false,
  phone_verification: true,
  google_login: false,
  customer_wallet_enabled: false,
  customer_virtual_accounts: false,
  leaderboard: false,
  group_orders: false,
  pickup_v1: false,
  delivery_handover_v1: false,
  sponsor_topup: false,
  feed_enabled: false,
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
