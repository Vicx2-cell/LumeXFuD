'use client'

import { useEffect, useState, useCallback } from 'react'

// Customer reward hub shown on the Profile screen: loyalty tier + progress,
// active reward-credit balance (auto-applied at checkout), a server-decided
// surprise scratch, and the referral share card. Self-fetching + self-gating:
// renders nothing until /api/rewards returns, and hides any section whose flag
// is off. No dark patterns — credits attach to orders the student already wants,
// the surprise outcome is fixed before opening, and nothing pressures a spend.

interface Summary {
  enabled: { referral: boolean; tiers: boolean; surprise: boolean }
  tier: {
    tier: 'BRONZE' | 'SILVER' | 'GOLD'
    orders_30d: number
    silver_at: number
    gold_at: number
    next_tier: 'SILVER' | 'GOLD' | null
    orders_to_next: number | null
  }
  credits: { total_kobo: number; items: Array<{ amount_kobo: number; label: string; expires_at: string | null }> }
  referral: {
    code: string
    link: string
    referred_count: number
    qualified_count: number
    reward_referrer_kobo: number
    reward_referred_kobo: number
  }
  surprise: { id: string; expires_at: string } | null
}

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`
const TIER_META: Record<string, { emoji: string; name: string }> = {
  BRONZE: { emoji: '🥉', name: 'Bronze' },
  SILVER: { emoji: '🥈', name: 'Silver' },
  GOLD: { emoji: '🥇', name: 'Gold' },
}

export function RewardsCard() {
  const [data, setData] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [opening, setOpening] = useState(false)
  const [reveal, setReveal] = useState<{ amount_kobo: number; label: string } | null>(null)

  const load = useCallback(() => {
    fetch('/api/rewards', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Summary) => setData(d))
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

  if (failed || !data) return null
  const { enabled, tier, credits, referral, surprise } = data
  // Nothing to show if every reward mechanic is disabled and the customer has no credits.
  if (!enabled.referral && !enabled.tiers && !enabled.surprise && credits.total_kobo === 0) return null

  async function openSurprise() {
    if (!surprise || opening) return
    setOpening(true)
    try {
      const res = await fetch(`/api/rewards/surprise/${surprise.id}/open`, { method: 'POST' })
      const d = (await res.json()) as { ok?: boolean; outcome_kobo?: number; label?: string; error?: string }
      if (res.ok && d.ok) {
        setReveal({ amount_kobo: d.outcome_kobo ?? 0, label: d.label ?? 'Surprise' })
        load() // refresh credit balance
      }
    } catch { /* ignore */ } finally { setOpening(false) }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referral.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }

  async function share() {
    const text = `Order food on LumeX Fud with my link and we both get a reward 🍲 ${referral.link}`
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: 'LumeX Fud', text, url: referral.link }) } catch { /* cancelled */ }
    } else {
      void copyLink()
    }
  }

  const tm = TIER_META[tier.tier]

  return (
    <div className="space-y-4">
      {/* Loyalty tier + progress */}
      {enabled.tiers && (
        <div className="lx-card-amber-soft rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">{tm.emoji}</span>
              <div>
                <p className="font-bold text-lg leading-none">{tm.name}</p>
                <p className="text-xs text-white/45 mt-1 tabular-nums">{tier.orders_30d} orders in the last 30 days</p>
              </div>
            </div>
            {credits.total_kobo > 0 && (
              <div className="text-right shrink-0">
                <p className="text-xs text-white/50">Rewards</p>
                <p className="lx-amber text-lg font-bold tabular-nums">{naira(credits.total_kobo)}</p>
              </div>
            )}
          </div>

          {tier.next_tier && tier.orders_to_next !== null && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-white/50 mb-1.5">
                <span>{tier.orders_to_next === 0 ? 'Unlocking…' : `${tier.orders_to_next} more order${tier.orders_to_next === 1 ? '' : 's'} to ${TIER_META[tier.next_tier].name}`}</span>
                <span aria-hidden="true">{TIER_META[tier.next_tier].emoji} free delivery</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.round((tier.orders_30d / (tier.next_tier === 'SILVER' ? tier.silver_at : tier.gold_at)) * 100))}%`,
                    background: 'linear-gradient(90deg,#FFE08A,#F5A623)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active credits (when tiers card isn't showing the balance) */}
      {!enabled.tiers && credits.total_kobo > 0 && (
        <div className="lx-card-amber-soft rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🎁</span>
            <div>
              <p className="lx-amber font-semibold tabular-nums">{naira(credits.total_kobo)} in rewards</p>
              <p className="text-xs text-white/45">Applied automatically at checkout</p>
            </div>
          </div>
        </div>
      )}
      {enabled.tiers && credits.items.length > 0 && (
        <p className="text-xs text-white/40 -mt-1 px-1">Rewards apply automatically at checkout — soonest to expire first.</p>
      )}

      {/* Surprise scratch */}
      {enabled.surprise && surprise && !reveal && (
        <button
          onClick={openSurprise}
          disabled={opening}
          className="lx-card-amber lx-tap w-full rounded-2xl p-4 flex items-center gap-3 text-left disabled:opacity-60"
        >
          <span className="text-2xl" aria-hidden="true">🎉</span>
          <div className="flex-1 min-w-0">
            <p className="lx-amber font-semibold">{opening ? 'Opening…' : 'You’ve got a surprise!'}</p>
            <p className="text-xs text-white/55">Tap to reveal your reward from your last order</p>
          </div>
        </button>
      )}
      {reveal && (
        <div className="lx-card-amber-soft rounded-2xl p-4 lx-enter text-center">
          {reveal.amount_kobo > 0 ? (
            <>
              <p className="text-2xl font-bold lx-amber">🎉 {naira(reveal.amount_kobo)} off!</p>
              <p className="text-xs text-white/55 mt-1">Added to your rewards — used automatically on your next order.</p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-white/85">No prize this time 🙈</p>
              <p className="text-xs text-white/45 mt-1">Thanks for ordering — there’s always next time.</p>
            </>
          )}
        </div>
      )}

      {/* Referral — "The Plug" */}
      {enabled.referral && (
        <div className="glass-thin rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">🔌</span>
            <h3 className="text-sm font-semibold text-white/80">Be the Plug</h3>
          </div>
          <p className="text-xs text-white/55 leading-relaxed">
            Share your link. When a friend signs up and completes their first two orders, you get{' '}
            <span className="lx-amber font-semibold">{naira(referral.reward_referrer_kobo)}</span> each time and they get{' '}
            <span className="lx-amber font-semibold">{naira(referral.reward_referred_kobo)}</span> to start.
          </p>

          <div className="flex items-center gap-2">
            <code
              className="flex-1 min-w-0 truncate rounded-xl px-3 py-2.5 text-sm font-mono tracking-wider"
              style={{ background: 'rgba(245,166,35,0.1)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.2)' }}
            >
              {referral.code}
            </code>
            <button
              onClick={copyLink}
              className="shrink-0 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', minHeight: 44 }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={share} className="lx-btn-amber shrink-0 px-4 py-2.5 text-xs" style={{ minHeight: 44 }}>
              Share
            </button>
          </div>

          {referral.referred_count > 0 && (
            <p className="text-xs text-white/40 tabular-nums">
              {referral.referred_count} joined · {referral.qualified_count} earning you rewards
            </p>
          )}
        </div>
      )}
    </div>
  )
}
