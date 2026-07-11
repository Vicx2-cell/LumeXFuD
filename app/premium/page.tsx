import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { loadPremiumPlans, loadPremiumStatus } from '@/lib/premium'
import { PremiumPurchaseActions } from '@/components/premium/purchase-actions'

export const dynamic = 'force-dynamic'

function formatMoney(kobo: number) {
  if (!Number.isFinite(kobo)) return '—'
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(kobo / 100)
}

function formatDate(value: string | null) {
  if (!value) return 'Not available'
  return new Date(value).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
}

const BENEFIT_LABELS: Record<string, string> = {
  tiktok_connection: 'TikTok connection',
  tiktok_selection_quota: 'TikTok selection quota',
  visibility_boost: 'Feed visibility uplift',
  analytics: 'Advanced analytics',
  scheduling: 'Scheduling',
  badge: 'Premium badge',
  unlimited_videos: 'Unlimited videos',
  selected_tiktok_videos: 'TikTok selection',
  pinning: 'Pinning',
  multiple_menu_tags: 'Multiple menu tags',
  templates: 'Templates',
  priority_support: 'Priority support',
  boost_discount_percent: 'Boost discount',
}

function benefitState(enabled: boolean) {
  return enabled ? 'Included' : 'Locked'
}

export default async function PremiumPage() {
  const [plans, status] = await Promise.all([loadPremiumPlans().catch(() => []), loadPremiumStatus().catch(() => null)])
  const plan = status?.effectivePlan ?? plans.find((item) => item.plan_key === status?.activePlanKey) ?? null
  const stateLabel = status?.subscriptionState ?? 'none'

  return (
    <main className="lx-page px-4 py-6 pb-24">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Premium"
          subtitle="Centralized Premium entitlements, versioned plans, and server-side access rules."
          badge="Subscriptions"
          back={false}
        />

        <section className="lx-surface p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/40">Current status</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-white capitalize">{stateLabel.replaceAll('_', ' ')}</h2>
                <Badge color={status?.premiumEnabled ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>{status?.premiumEnabled ? 'Premium enabled' : 'Premium disabled'}</Badge>
                {status?.premiumUIVisible === false && <Badge color="rgba(255,255,255,0.35)">UI hidden by admin</Badge>}
                {status?.hasPremium && <Badge color="var(--lx-amber)">Entitlement active</Badge>}
              </div>
              <p className="mt-2 text-sm text-white/60">
                {status?.disabledReason ?? 'Entitlements are resolved server-side from the active plan, overrides, and global Premium policy.'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-white/40">Checkout is live when Premium is enabled and subscriptions are open.</p>
              {plan && (
                <PremiumPurchaseActions
                  planKey={plan.plan_key}
                  monthlyPriceLabel={formatMoney(plan.monthly_price_kobo)}
                  yearlyPriceLabel={formatMoney(plan.yearly_price_kobo)}
                  premiumEnabled={Boolean(status?.premiumEnabled)}
                  newSubscriptionsEnabled={Boolean(status?.newSubscriptionsEnabled)}
                />
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Plan</p>
              <p className="mt-1 text-white font-semibold">{plan?.name ?? 'Free tier'}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Renewal / expiry</p>
              <p className="mt-1 text-white font-semibold">{formatDate(status?.renewalOrExpiryAt ?? null)}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Monthly</p>
              <p className="mt-1 text-white font-semibold">{formatMoney(plan?.monthly_price_kobo ?? 0)}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Yearly</p>
              <p className="mt-1 text-white font-semibold">{formatMoney(plan?.yearly_price_kobo ?? 0)}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Trial terms</p>
              <p className="mt-1 text-white font-semibold">{plan?.trial_duration_days ?? 0} days</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Grace period</p>
              <p className="mt-1 text-white font-semibold">{plan?.grace_period_days ?? 0} days</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Fallback policy</p>
              <p className="mt-1 text-white font-semibold">{status?.premiumFallbackPolicy ?? 'preserve_existing_until_expiry'}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="lx-surface p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Free vs Premium</p>
                <h3 className="text-lg font-semibold text-white">Entitlement comparison</h3>
              </div>
              <Badge color="rgba(255,255,255,0.28)">Server-authoritative</Badge>
            </div>
            <div className="space-y-2">
              {Object.entries(status?.entitlements ?? {}).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-xl border border-white/8 px-3 py-2 bg-white/[0.03]">
                  <span className="text-sm text-white/75">{BENEFIT_LABELS[key] ?? key.replaceAll('.', ' ')}</span>
                  <span className={`text-xs font-semibold ${value ? 'text-emerald-300' : 'text-white/35'}`}>
                    {typeof value === 'number' ? value : benefitState(Boolean(value))}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="lx-surface p-4 space-y-3">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Plan details</p>
            {plan ? (
              <>
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                {plan.description && <p className="text-sm text-white/60">{plan.description}</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
                    <p className="text-xs uppercase tracking-wide text-white/40">Audience</p>
                    <p className="mt-1 text-white font-semibold">{plan.audience}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
                    <p className="text-xs uppercase tracking-wide text-white/40">Version</p>
                    <p className="mt-1 text-white font-semibold">{plan.latest_version ?? plan.version}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge color={plan.is_active ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>{plan.is_active ? 'Active plan' : 'Inactive plan'}</Badge>
                  {status?.subscriptionState === 'grace_period' && <Badge color="var(--lx-amber)">Grace period</Badge>}
                  {status?.subscriptionState === 'past_due' && <Badge color="var(--lx-amber)">Past due</Badge>}
                  {status?.subscriptionState === 'canceled' && <Badge color="rgba(255,255,255,0.35)">Canceled until expiry</Badge>}
                </div>
              </>
            ) : (
              <p className="text-sm text-white/60">No paid plan is currently assigned. Free-tier defaults remain in effect.</p>
            )}
          </article>
        </section>

        <section className="lx-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Vendor surface</p>
              <h3 className="text-lg font-semibold text-white">Locked and available feature states</h3>
            </div>
            <Badge color={status?.premiumUIVisible ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>{status?.premiumUIVisible ? 'Visible to vendors' : 'Hidden by admin'}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(status?.benefits ?? {}).map(([key, enabled]) => (
              <div key={key} className="rounded-xl border border-white/8 px-3 py-2 bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white/75">{BENEFIT_LABELS[key] ?? key.replaceAll('_', ' ')}</span>
                  <span className={`text-xs font-semibold ${enabled ? 'text-emerald-300' : 'text-white/35'}`}>{enabled ? 'Available' : 'Locked'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lx-surface p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Plans</p>
              <h3 className="text-lg font-semibold text-white">Plan catalog</h3>
            </div>
            <Badge color="rgba(255,255,255,0.28)">{plans.length} plan(s)</Badge>
          </div>
          {plans.length === 0 ? (
            <p className="text-sm text-white/60">No active Premium plans are configured yet.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {plans.map((item) => (
                <article key={item.id} className="rounded-3xl border border-white/8 p-4 bg-white/[0.03] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-white/40">{item.audience}</p>
                      <h4 className="text-xl font-semibold text-white">{item.name}</h4>
                      {item.description && <p className="text-sm text-white/60 mt-1">{item.description}</p>}
                    </div>
                    <Badge color={item.is_active ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>
                      {item.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl border border-white/8 p-3 bg-black/10">
                      <p className="text-xs uppercase tracking-wide text-white/40">Monthly</p>
                      <p className="mt-1 text-white font-semibold">{formatMoney(item.monthly_price_kobo)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/8 p-3 bg-black/10">
                      <p className="text-xs uppercase tracking-wide text-white/40">Yearly</p>
                      <p className="mt-1 text-white font-semibold">{formatMoney(item.yearly_price_kobo)}</p>
                    </div>
                  </div>
                  {item.latest_change_summary && (
                    <p className="text-xs text-white/40">Latest version {item.latest_version ?? item.version}: {item.latest_change_summary}</p>
                  )}
                  <PremiumPurchaseActions
                    planKey={item.plan_key}
                    monthlyPriceLabel={formatMoney(item.monthly_price_kobo)}
                    yearlyPriceLabel={formatMoney(item.yearly_price_kobo)}
                    premiumEnabled={Boolean(status?.premiumEnabled)}
                    newSubscriptionsEnabled={Boolean(status?.newSubscriptionsEnabled)}
                  />
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
