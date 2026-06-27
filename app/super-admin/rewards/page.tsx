'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

// Friendly control panel for every gamification reward knob (migrations 082/083):
// surprise odds + prizes, the per-order profit floor, referral amounts, credit
// expiry, and loyalty-tier thresholds + perk. Money is shown in Naira; the API
// stores kobo. Live readouts show what each choice costs you per order.

type Outcome = { kobo: number; weight: number }
type RewardSettings = {
  surprise: { outcomes: Outcome[]; expiry_days: number }
  floor_kobo: number
  referral: { referrer_kobo: number; referred_kobo: number }
  credit: { expiry_days: number; min_order_kobo: number }
  tiers: { silver_orders: number; gold_orders: number; free_delivery_kobo: number }
}

const naira = (kobo: number) => Math.round(kobo / 100)
const fmt = (kobo: number) => `₦${naira(kobo).toLocaleString('en-NG')}`

function NairaInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (kobo: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <div className="flex items-center mt-1 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <span className="px-3 text-white/40 text-sm">₦</span>
        <input type="number" min={0} inputMode="numeric"
          value={Number.isFinite(value) ? naira(value) : 0}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)) * 100)}
          className="flex-1 bg-transparent py-3 pr-3 text-base outline-none tabular-nums" style={{ color: '#fff' }} />
      </div>
      {hint && <span className="text-xs text-white/35 mt-1 block">{hint}</span>}
    </label>
  )
}

function NumInput({ label, value, onChange, suffix, hint }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <div className="flex items-center mt-1 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <input type="number" min={0} inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="flex-1 bg-transparent py-3 px-3 text-base outline-none tabular-nums" style={{ color: '#fff' }} />
        {suffix && <span className="px-3 text-white/40 text-sm whitespace-nowrap">{suffix}</span>}
      </div>
      {hint && <span className="text-xs text-white/35 mt-1 block">{hint}</span>}
    </label>
  )
}

export default function SuperAdminRewards() {
  const [s, setS] = useState<RewardSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }

  useEffect(() => {
    fetch('/api/super-admin/rewards')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RewardSettings | null) => { if (d) setS(d) })
      .finally(() => setLoading(false))
  }, [])

  function patch(updater: (prev: RewardSettings) => RewardSettings) {
    setS((prev) => (prev ? updater(prev) : prev)); setError('')
  }

  // Live surprise stats
  const totalWeight = s ? s.surprise.outcomes.reduce((a, o) => a + o.weight, 0) : 0
  const expectedKobo = s && totalWeight > 0 ? s.surprise.outcomes.reduce((a, o) => a + o.kobo * o.weight, 0) / totalWeight : 0
  const winChance = s && totalWeight > 0 ? s.surprise.outcomes.filter((o) => o.kobo > 0).reduce((a, o) => a + o.weight, 0) / totalWeight : 0

  async function save() {
    if (!s) return
    if (totalWeight <= 0) { setError('At least one surprise outcome needs a weight above 0.'); return }
    if (s.tiers.gold_orders <= s.tiers.silver_orders) { setError('Gold must need more orders than Silver.'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/super-admin/rewards', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
    })
    const d = (await res.json()) as { error?: string }
    if (res.ok) showToast('Rewards updated — live in ~20 seconds')
    else setError(d.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium lx-scale-in"
          role="status" aria-live="polite" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="relative z-10 mx-auto max-w-lg lx-enter">
        <PageHeader title="Rewards" subtitle="Surprise odds, referral & tier perks — applies to new orders" badge="Super Admin" />

        {loading || !s ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-32" style={{ borderRadius: 20 }} />)}</div>
        ) : (
          <div className="space-y-4">
            {/* Profit floor */}
            <div className="lx-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">Minimum profit per order</h2>
              <NairaInput label="Never let a reward drop your profit below" value={s.floor_kobo}
                onChange={(kobo) => patch((p) => ({ ...p, floor_kobo: kobo }))}
                hint="Every order keeps at least this for you. Bigger rewards just spread across more orders." />
            </div>

            {/* Surprise */}
            <div className="lx-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white/80">🎉 Surprise reward</h2>
                <button
                  onClick={() => patch((p) => ({ ...p, surprise: { ...p.surprise, outcomes: [...p.surprise.outcomes, { kobo: 0, weight: 10 }] } }))}
                  className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(245,166,35,0.14)', color: '#F5A623' }}>+ Add prize</button>
              </div>
              <p className="text-xs text-white/40">Each row is a possible outcome. <span className="text-white/60">Prize</span> ₦0 = no win. <span className="text-white/60">Chance</span> is relative — they don&apos;t need to total anything.</p>

              <div className="space-y-2">
                {s.surprise.outcomes.map((o, i) => {
                  const pct = totalWeight > 0 ? Math.round((o.weight / totalWeight) * 100) : 0
                  return (
                    <div key={i} className="flex items-end gap-2">
                      <div className="flex-1"><NairaInput label={i === 0 ? 'Prize' : ''} value={o.kobo}
                        onChange={(kobo) => patch((p) => { const out = [...p.surprise.outcomes]; out[i] = { ...out[i], kobo }; return { ...p, surprise: { ...p.surprise, outcomes: out } } })} /></div>
                      <div className="w-24"><NumInput label={i === 0 ? 'Chance' : ''} value={o.weight}
                        onChange={(n) => patch((p) => { const out = [...p.surprise.outcomes]; out[i] = { ...out[i], weight: n }; return { ...p, surprise: { ...p.surprise, outcomes: out } } })} /></div>
                      <div className="w-10 pb-3 text-xs text-white/45 tabular-nums text-right">{pct}%</div>
                      <button aria-label="Remove prize" disabled={s.surprise.outcomes.length <= 1}
                        onClick={() => patch((p) => ({ ...p, surprise: { ...p.surprise, outcomes: p.surprise.outcomes.filter((_, j) => j !== i) } }))}
                        className="pb-3 text-white/30 hover:text-red-400 disabled:opacity-20 text-lg leading-none">×</button>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.16)' }}>
                <div className="flex justify-between"><span className="text-white/55">Chance of any prize</span><span className="lx-amber font-semibold tabular-nums">{Math.round(winChance * 100)}%</span></div>
                <div className="flex justify-between"><span className="text-white/55">Avg. cost per order (before redemption)</span><span className="lx-amber font-semibold tabular-nums">{fmt(expectedKobo)}</span></div>
                <p className="text-white/35 pt-1">Real cost is lower — not every surprise gets opened or used before it expires.</p>
              </div>

              <NumInput label="Surprise expires after" value={s.surprise.expiry_days} suffix="days"
                onChange={(n) => patch((p) => ({ ...p, surprise: { ...p.surprise, expiry_days: n } }))} />
            </div>

            {/* Referral */}
            <div className="lx-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">🔌 Referral ("The Plug")</h2>
              <p className="text-xs text-white/40">Paid on the new friend&apos;s 1st AND 2nd completed order (so each is paid twice per friend).</p>
              <NairaInput label="Referrer gets (each time)" value={s.referral.referrer_kobo} onChange={(kobo) => patch((p) => ({ ...p, referral: { ...p.referral, referrer_kobo: kobo } }))} />
              <NairaInput label="New friend gets (each time)" value={s.referral.referred_kobo} onChange={(kobo) => patch((p) => ({ ...p, referral: { ...p.referral, referred_kobo: kobo } }))} />
            </div>

            {/* Tiers */}
            <div className="lx-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">🥇 Loyalty tiers</h2>
              <p className="text-xs text-white/40">Based on completed orders in the last 30 days.</p>
              <NumInput label="Orders to reach Silver" value={s.tiers.silver_orders} suffix="orders / 30 days" onChange={(n) => patch((p) => ({ ...p, tiers: { ...p.tiers, silver_orders: n } }))} />
              <NumInput label="Orders to reach Gold" value={s.tiers.gold_orders} suffix="orders / 30 days" onChange={(n) => patch((p) => ({ ...p, tiers: { ...p.tiers, gold_orders: n } }))} />
              <NairaInput label="Silver/Gold monthly free-delivery credit" value={s.tiers.free_delivery_kobo} onChange={(kobo) => patch((p) => ({ ...p, tiers: { ...p.tiers, free_delivery_kobo: kobo } }))} hint="Granted once a month at Silver/Gold; still capped by your profit floor." />
            </div>

            {/* Credit rules */}
            <div className="lx-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">Reward credit rules</h2>
              <NumInput label="Rewards expire after" value={s.credit.expiry_days} suffix="days" onChange={(n) => patch((p) => ({ ...p, credit: { ...p.credit, expiry_days: n } }))} />
              <NairaInput label="Minimum order to use a reward" value={s.credit.min_order_kobo} onChange={(kobo) => patch((p) => ({ ...p, credit: { ...p.credit, min_order_kobo: kobo } }))} />
            </div>

            {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}

            <button onClick={save} disabled={saving} className="lx-btn-amber w-full py-4" style={{ minHeight: 56 }}>
              {saving ? 'Saving…' : 'Save rewards'}
            </button>
            <p className="text-xs text-white/35 text-center">Changes are recorded in the super-audit log.</p>
          </div>
        )}
      </div>
    </div>
  )
}
