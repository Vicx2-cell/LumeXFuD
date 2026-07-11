'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'
import { Badge } from '@/components/ui/badge'

type PremiumPlan = {
  id: string
  plan_key: string
  name: string
  description: string | null
  monthly_price_kobo: number
  yearly_price_kobo: number
  currency: string
  trial_duration_days: number
  grace_period_days: number
  audience: 'customer' | 'vendor' | 'rider' | 'admin' | 'all'
  included_benefits: Record<string, boolean>
  display_order: number
  paystack_plan_reference: string | null
  version: number
  effective_from: string | null
  is_active: boolean
  latest_version?: number | null
  latest_change_summary?: string | null
}

type PremiumConfig = {
  premiumEnabled: boolean
  newSubscriptionsEnabled: boolean
  trialsEnabled: boolean
  premiumUIVisible: boolean
  preserveExistingUntilExpiry: boolean
  immediateDisableExistingBenefits: boolean
  premiumFallbackPolicy: 'deny_all_premium_features' | 'grant_all_premium_features' | 'preserve_existing_until_expiry'
}

type PremiumAudit = {
  id: string
  action: string
  target_type: string
  target_id: string | null
  reason: string | null
  created_at: string
  actor: string | null
}

type PremiumState = {
  plans: PremiumPlan[]
  config: PremiumConfig | null
  audit: PremiumAudit[]
  inspected: unknown
}

const BENEFIT_LABELS: Record<string, string> = {
  'premium.tiktok.connect': 'TikTok connection',
  'premium.tiktok.video_limit': 'TikTok video limit',
  'premium.video.active_limit': 'Active video limit',
  'premium.video.unlimited': 'Unlimited videos',
  'premium.feed.visibility_boost': 'Visibility uplift',
  'premium.analytics.advanced': 'Advanced analytics',
  'premium.posts.schedule': 'Scheduling',
  'premium.posts.pin': 'Pinning',
  'premium.badge': 'Badge',
  'premium.menu.multiple_tags': 'Multiple menu tags',
  'premium.templates': 'Templates',
  'premium.support.priority': 'Priority support',
  'premium.boost.discount_percent': 'Boost discount',
}

function fmtMoney(kobo: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format((kobo || 0) / 100)
}

function toKobo(naira: string) {
  const parsed = Number(naira.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0
}

function MoneyField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  hint?: string
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.16em] text-white/45">{label}</span>
      <div className="mt-1 flex items-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <span className="px-3 text-sm text-white/40">₦</span>
        <input
          inputMode="decimal"
          value={Number.isFinite(value) ? Math.round(value / 100) : 0}
          onChange={(e) => onChange(toKobo(e.target.value))}
          className="w-full bg-transparent px-3 py-3 text-sm text-white outline-none"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-white/35">{hint}</p>}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left"
    >
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-white/40">{checked ? 'On' : 'Off'}</p>
      </div>
      <span
        className="relative h-7 w-12 rounded-full transition-colors"
        style={{ background: checked ? '#F5A623' : 'rgba(255,255,255,0.12)' }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all"
          style={{ left: checked ? 'calc(100% - 24px)' : '4px' }}
        />
      </span>
    </button>
  )
}

function PlanEditor({
  plan,
  onSave,
}: {
  plan: PremiumPlan
  onSave: (plan: PremiumPlan) => Promise<void>
}) {
  const [draft, setDraft] = useState(plan)
  const [busy, setBusy] = useState(false)
  const benefitKeys = useMemo(() => Object.keys(BENEFIT_LABELS), [])

  return (
    <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">Plan</p>
          <h3 className="text-xl font-semibold text-white">{draft.name}</h3>
          <p className="text-sm text-white/55">{draft.plan_key}</p>
        </div>
        <Badge color={draft.is_active ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>{draft.is_active ? 'Active' : 'Inactive'}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Plan key</span>
          <input value={draft.plan_key} onChange={(e) => setDraft((prev) => ({ ...prev, plan_key: e.target.value }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Name</span>
          <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
      </div>

      <label className="block">
        <span className="text-xs uppercase tracking-[0.16em] text-white/45">Description</span>
        <textarea value={draft.description ?? ''} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} rows={3} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <MoneyField label="Monthly price" value={draft.monthly_price_kobo} onChange={(value) => setDraft((prev) => ({ ...prev, monthly_price_kobo: value }))} />
        <MoneyField label="Yearly price" value={draft.yearly_price_kobo} onChange={(value) => setDraft((prev) => ({ ...prev, yearly_price_kobo: value }))} />
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Trial days</span>
          <input type="number" min={0} value={draft.trial_duration_days} onChange={(e) => setDraft((prev) => ({ ...prev, trial_duration_days: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Grace days</span>
          <input type="number" min={0} value={draft.grace_period_days} onChange={(e) => setDraft((prev) => ({ ...prev, grace_period_days: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Audience</span>
          <select value={draft.audience} onChange={(e) => setDraft((prev) => ({ ...prev, audience: e.target.value as PremiumPlan['audience'] }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
            <option value="vendor">vendor</option>
            <option value="customer">customer</option>
            <option value="rider">rider</option>
            <option value="admin">admin</option>
            <option value="all">all</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Display order</span>
          <input type="number" min={0} value={draft.display_order} onChange={(e) => setDraft((prev) => ({ ...prev, display_order: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Paystack plan ref</span>
          <input value={draft.paystack_plan_reference ?? ''} onChange={(e) => setDraft((prev) => ({ ...prev, paystack_plan_reference: e.target.value }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Change summary</span>
          <input value={draft.latest_change_summary ?? ''} onChange={(e) => setDraft((prev) => ({ ...prev, latest_change_summary: e.target.value }))} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {benefitKeys.map((key) => (
          <Toggle
            key={key}
            label={BENEFIT_LABELS[key]}
            checked={Boolean(draft.included_benefits[key])}
            onChange={(next) => setDraft((prev) => ({
              ...prev,
              included_benefits: { ...prev.included_benefits, [key]: next },
            }))}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          label="Active plan"
          checked={draft.is_active}
          onChange={(next) => setDraft((prev) => ({ ...prev, is_active: next }))}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onSave({
              ...draft,
              monthly_price_kobo: Math.max(0, Math.round(draft.monthly_price_kobo)),
              yearly_price_kobo: Math.max(0, Math.round(draft.yearly_price_kobo)),
            })
            setBusy(false)
          }}
          className="lx-btn-amber px-4 py-3 text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save plan'}
        </button>
      </div>

      <div className="text-xs text-white/45">
        Monthly {fmtMoney(draft.monthly_price_kobo)} · Yearly {fmtMoney(draft.yearly_price_kobo)} · Version {draft.version}
      </div>
    </article>
  )
}

export default function SuperAdminPremiumPage() {
  const [state, setState] = useState<PremiumState>({ plans: [], config: null, audit: [], inspected: null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [profileId, setProfileId] = useState('')
  const [grantProfileId, setGrantProfileId] = useState('')
  const [entitlementKey, setEntitlementKey] = useState('premium.analytics.advanced')
  const [overrideType, setOverrideType] = useState<'grant' | 'deny' | 'value'>('grant')
  const [overrideValue, setOverrideValue] = useState('true')
  const [reason, setReason] = useState('')

  const showToast = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const res = await fetch('/api/super-admin/premium')
      const data = res.ok ? await res.json() as PremiumState : null
      if (mounted && data) setState(data)
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function load(profile?: string) {
    const url = profile ? `/api/super-admin/premium?profile_id=${encodeURIComponent(profile)}` : '/api/super-admin/premium'
    const res = await fetch(url)
    const data = res.ok ? await res.json() as PremiumState : null
    if (data) setState(data)
    setLoading(false)
  }

  async function saveConfig(next: Partial<PremiumConfig>) {
    if (!state.config) return
    setBusy(true)
    const payload = {
      action: 'set_config',
      ...state.config,
      ...next,
    }
    const res = await fetch('/api/super-admin/premium', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      showToast('Premium config saved')
      await load(profileId)
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      showToast(d.error ?? 'Failed to save config')
    }
    setBusy(false)
  }

  async function savePlan(plan: PremiumPlan) {
    setBusy(true)
    const res = await fetch('/api/super-admin/premium', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...plan,
        monthly_price_kobo: Math.max(0, Math.round(plan.monthly_price_kobo)),
        yearly_price_kobo: Math.max(0, Math.round(plan.yearly_price_kobo)),
        change_summary: plan.latest_change_summary ?? 'Updated premium plan',
      }),
    })
    if (res.ok) {
      showToast(`Saved ${plan.name}`)
      await load(profileId)
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      showToast(d.error ?? 'Could not save plan')
    }
    setBusy(false)
  }

  async function grantOverride(action: 'grant_override' | 'revoke_override') {
    setBusy(true)
    const parsedValue = overrideValue.trim()
    const entitlementValue = parsedValue === 'true' ? true : parsedValue === 'false' ? false : Number.isFinite(Number(parsedValue)) ? Number(parsedValue) : parsedValue
    const res = await fetch('/api/super-admin/premium', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        profile_id: grantProfileId,
        entitlement_key: entitlementKey,
        override_type: overrideType,
        entitlement_value: entitlementValue,
        reason,
      }),
    })
    if (res.ok) {
      showToast(action === 'grant_override' ? 'Override saved' : 'Override revoked')
      await load(profileId)
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      showToast(d.error ?? 'Override failed')
    }
    setBusy(false)
  }

  const config = state.config

  return (
    <main className="lx-page px-4 py-6 pb-24">
      <GlassSheen />
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black shadow-xl">
          {toast}
        </div>
      )}
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader
          title="Premium Control"
          subtitle="Fix pricing, toggle access, inspect subscriptions, and manage manual entitlements."
          badge="Super Admin"
        />

        <section className="lx-surface p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Global controls</p>
              <h2 className="text-xl font-semibold text-white">Premium is controlled from here</h2>
              <p className="mt-1 text-sm text-white/55">This is the page you were looking for when you asked where the Premium price can be fixed.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color={config?.premiumEnabled ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>{config?.premiumEnabled ? 'Enabled' : 'Disabled'}</Badge>
              <Badge color="rgba(255,255,255,0.35)">{config?.premiumFallbackPolicy ?? 'preserve_existing_until_expiry'}</Badge>
            </div>
          </div>

          {config && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Toggle label="Premium enabled" checked={config.premiumEnabled} onChange={(next) => void saveConfig({ premiumEnabled: next })} />
              <Toggle label="New subscriptions" checked={config.newSubscriptionsEnabled} onChange={(next) => void saveConfig({ newSubscriptionsEnabled: next })} />
              <Toggle label="Trials enabled" checked={config.trialsEnabled} onChange={(next) => void saveConfig({ trialsEnabled: next })} />
              <Toggle label="UI visible" checked={config.premiumUIVisible} onChange={(next) => void saveConfig({ premiumUIVisible: next })} />
            </div>
          )}

          {config && (
            <div className="grid gap-3 md:grid-cols-3">
              <Toggle label="Preserve until expiry" checked={config.preserveExistingUntilExpiry} onChange={(next) => void saveConfig({ preserveExistingUntilExpiry: next })} />
              <Toggle label="Immediate disable benefits" checked={config.immediateDisableExistingBenefits} onChange={(next) => void saveConfig({ immediateDisableExistingBenefits: next })} />
              <label className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Fallback policy</span>
                <select
                  value={config.premiumFallbackPolicy}
                  onChange={(e) => void saveConfig({ premiumFallbackPolicy: e.target.value as PremiumConfig['premiumFallbackPolicy'] })}
                  className="mt-1 w-full bg-transparent text-sm text-white outline-none"
                >
                  <option value="deny_all_premium_features">deny_all_premium_features</option>
                  <option value="grant_all_premium_features">grant_all_premium_features</option>
                  <option value="preserve_existing_until_expiry">preserve_existing_until_expiry</option>
                </select>
              </label>
            </div>
          )}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Plans</p>
                <h3 className="text-lg font-semibold text-white">Fix pricing and plan versions</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next: PremiumPlan = {
                    id: `draft-${Date.now()}`,
                    plan_key: `new-plan-${Date.now()}`,
                    name: 'New Premium Plan',
                    description: '',
                    monthly_price_kobo: 0,
                    yearly_price_kobo: 0,
                    currency: 'NGN',
                    trial_duration_days: 0,
                    grace_period_days: 0,
                    audience: 'vendor',
                    included_benefits: {
                      'premium.tiktok.connect': false,
                      'premium.tiktok.video_limit': false,
                      'premium.video.active_limit': true,
                      'premium.video.unlimited': false,
                      'premium.feed.visibility_boost': false,
                      'premium.analytics.advanced': false,
                      'premium.posts.schedule': false,
                      'premium.posts.pin': false,
                      'premium.badge': false,
                      'premium.menu.multiple_tags': false,
                      'premium.templates': false,
                      'premium.support.priority': false,
                      'premium.boost.discount_percent': false,
                    },
                    display_order: 100,
                    paystack_plan_reference: null,
                    version: 1,
                    effective_from: null,
                    is_active: true,
                  }
                  setState((prev) => ({ ...prev, plans: [next, ...prev.plans] }))
                }}
                className="lx-btn-secondary px-3 py-2 text-xs"
              >
                Add plan draft
              </button>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((n) => <div key={n} className="lx-skeleton h-96 rounded-[28px]" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {state.plans.map((plan) => (
                  <PlanEditor key={`${plan.id}:${plan.version}:${plan.is_active ? '1' : '0'}:${plan.latest_change_summary ?? ''}`} plan={plan} onSave={savePlan} />
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section className="lx-surface p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Manual access</p>
                <h3 className="text-lg font-semibold text-white">Grant or revoke entitlement overrides</h3>
              </div>
              <label className="block">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Profile ID</span>
                <input value={grantProfileId} onChange={(e) => setGrantProfileId(e.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" placeholder="profile-..." />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Entitlement key</span>
                <input value={entitlementKey} onChange={(e) => setEntitlementKey(e.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.16em] text-white/45">Override type</span>
                  <select value={overrideType} onChange={(e) => setOverrideType(e.target.value as typeof overrideType)} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
                    <option value="grant">grant</option>
                    <option value="deny">deny</option>
                    <option value="value">value</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.16em] text-white/45">Value</span>
                  <input value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" placeholder="true, false, 10" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Reason</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !grantProfileId.trim()} onClick={() => void grantOverride('grant_override')} className="lx-btn-amber px-4 py-3 text-sm disabled:opacity-50">Grant / update</button>
                <button type="button" disabled={busy || !grantProfileId.trim()} onClick={() => void grantOverride('revoke_override')} className="lx-btn-secondary px-4 py-3 text-sm">Revoke</button>
              </div>
            </section>

            <section className="lx-surface p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Inspect user</p>
                <h3 className="text-lg font-semibold text-white">Check current Premium state</h3>
              </div>
              <div className="flex gap-2">
                <input value={profileId} onChange={(e) => setProfileId(e.target.value)} className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" placeholder="profile id" />
                <button type="button" onClick={() => void load(profileId)} className="lx-btn-secondary px-4 py-3 text-sm">Load</button>
              </div>
              {state.inspected ? (
                <pre className="max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3 text-xs text-white/70">{JSON.stringify(state.inspected, null, 2)}</pre>
              ) : (
                <p className="text-sm text-white/45">Search a profile to inspect entitlement state and active plan resolution.</p>
              )}
            </section>

            <section className="lx-surface p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Audit</p>
                <h3 className="text-lg font-semibold text-white">Recent Premium changes</h3>
              </div>
              <div className="space-y-2">
                {state.audit.slice(0, 6).map((row) => (
                  <div key={row.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{row.action}</p>
                        <p className="text-xs text-white/45">{row.target_type}{row.target_id ? ` · ${row.target_id}` : ''}</p>
                      </div>
                      <span className="text-xs text-white/35">{new Date(row.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</span>
                    </div>
                    {row.reason && <p className="mt-2 text-xs text-white/55">{row.reason}</p>}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  )
}
