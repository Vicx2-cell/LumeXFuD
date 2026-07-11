import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { BoostCheckoutForm } from '@/components/boosts/boost-checkout-form'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { loadVendorVideoLibrary } from '@/lib/feed/lifecycle'
import { loadPremiumStatus } from '@/lib/premium'
import { getFeature } from '@/lib/features'

export const dynamic = 'force-dynamic'

function fmtMoney(kobo: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(kobo / 100)
}

export default async function VendorBoostsPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') {
    redirect('/auth')
  }

  const [library, premiumStatus, boostsEnabled] = await Promise.all([
    loadVendorVideoLibrary('active', 50).catch(() => ({ items: [], quota: null, suggestions: [], config: null })),
    loadPremiumStatus().catch(() => null),
    getFeature('post_boosts_enabled').catch(() => false),
  ])

  const db = createSupabaseAdmin()
  const { data: packages } = await db
    .from('boost_packages')
    .select('id, package_key, name, description, duration_days, budget_kobo, geographic_radius_km, max_uplift, is_active, display_order')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false })

  const postOptions = (library.items ?? []).map((item) => ({
    id: item.id,
    caption: item.caption ?? item.post_kind,
    status: item.status,
    created_at: item.created_at,
  }))

  return (
    <main className="lx-page px-4 py-6 pb-24">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Boosts"
          subtitle="Choose one post, pick a package, and start a verified Paystack boost purchase."
          badge="Sponsored"
          back={false}
        />

        <section className="lx-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Status</p>
              <h2 className="text-xl font-semibold text-white">Boost billing</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color={boostsEnabled ? 'var(--lx-green)' : 'rgba(255,255,255,0.35)'}>{boostsEnabled ? 'Boosts enabled' : 'Boosts disabled'}</Badge>
              {typeof premiumStatus?.entitlements?.['premium.boost.discount_percent'] === 'number' && (
                <Badge color="var(--lx-amber)">Premium discount {premiumStatus.entitlements['premium.boost.discount_percent']}%</Badge>
              )}
            </div>
          </div>
          <p className="text-sm text-white/60">
            Boosts cannot bypass moderation, archived content, deleted content, blocked viewers, or unavailable vendors.
          </p>
        </section>

        {postOptions.length === 0 ? (
          <EmptyState title="No active posts" description="Publish at least one active post before buying a boost." />
        ) : packages?.length ? (
          <section className="lx-surface p-4 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Purchase flow</p>
              <h3 className="text-lg font-semibold text-white">Select post and package</h3>
            </div>
            <BoostCheckoutForm
              posts={postOptions}
              packages={(packages ?? []).map((pkg) => ({
                id: pkg.id,
                package_key: pkg.package_key,
                name: pkg.name,
                description: pkg.description,
                duration_days: pkg.duration_days,
                budget_kobo: pkg.budget_kobo,
                geographic_radius_km: pkg.geographic_radius_km,
                max_uplift: pkg.max_uplift,
              }))}
            />
          </section>
        ) : (
          <EmptyState title="No boost packages" description="Admin has not configured any active boost packages yet." />
        )}

        <section className="lx-surface p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Eligible posts</p>
              <h3 className="text-lg font-semibold text-white">{postOptions.length} active post(s)</h3>
            </div>
            <Badge color="rgba(255,255,255,0.28)">Server-filtered</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {postOptions.slice(0, 6).map((post) => (
              <article key={post.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <p className="font-medium text-white truncate">{post.caption}</p>
                <p className="text-xs text-white/45 mt-1">{post.status} · {new Date(post.created_at).toLocaleDateString('en-NG')}</p>
              </article>
            ))}
          </div>
          <p className="text-xs text-white/40">Boost charges are finalized only after Paystack verification. Prices are shown in NGN.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {(packages ?? []).slice(0, 6).map((pkg) => (
              <article key={pkg.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{pkg.name}</p>
                    <p className="text-xs text-white/45 mt-1">{pkg.description}</p>
                  </div>
                  <Badge color="var(--lx-green)">{fmtMoney(pkg.budget_kobo)}</Badge>
                </div>
                <p className="text-xs text-white/40 mt-2">
                  {pkg.duration_days} day(s) · radius {pkg.geographic_radius_km} km · max uplift {Math.round(pkg.max_uplift * 100)}%
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
