import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { currentReferralHub } from '@/lib/referrals'
import { formatPrice } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function ReferralsPage() {
  const hub = await currentReferralHub().catch(() => null)

  return (
    <main className="lx-page px-4 py-6 pb-24">
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader
          title="Referral Rewards"
          subtitle="Unique codes and server-side rewards for customers, vendors, riders, and campus partners."
          badge="Growth"
          back={false}
        />

        {!hub ? (
          <section className="lx-surface p-4">
            <p className="text-sm text-white/60">Sign in to see your referral code and reward history.</p>
          </section>
        ) : (
          <>
            <section className="lx-surface p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/40">Your code</p>
                  <h2 className="text-2xl font-semibold text-white">{hub.code}</h2>
                  <p className="text-sm text-white/55 break-all">{hub.link}</p>
                </div>
                <Badge color="var(--lx-green)">{hub.role}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-xs uppercase tracking-wide text-white/40">Referred</p>
                  <p className="mt-1 text-xl font-semibold text-white">{hub.referred_count}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-xs uppercase tracking-wide text-white/40">Approved</p>
                  <p className="mt-1 text-xl font-semibold text-white">{hub.approved_count}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-xs uppercase tracking-wide text-white/40">Pending</p>
                  <p className="mt-1 text-xl font-semibold text-white">{hub.pending_count}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-xs uppercase tracking-wide text-white/40">Referrer reward</p>
                  <p className="mt-1 text-xl font-semibold text-white">{formatPrice(hub.reward_referrer_kobo)}</p>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-3 text-sm text-white/65">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">Daily limit: {hub.limits.daily}</div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">Monthly limit: {hub.limits.monthly}</div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">Device limit: {hub.limits.device}</div>
              </div>
            </section>

            <section className="lx-surface p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">History</p>
                <h3 className="text-lg font-semibold text-white">Referral reward timeline</h3>
              </div>
              <div className="space-y-2">
                {hub.history.length === 0 ? (
                  <p className="text-sm text-white/55">No referrals yet.</p>
                ) : hub.history.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{row.referred_role} · {row.status}</p>
                      <p className="text-xs text-white/45">{new Date(row.created_at).toLocaleString('en-NG')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-white">{formatPrice(row.reward_referrer_kobo)} / {formatPrice(row.reward_referred_kobo)}</p>
                      <p className="text-xs text-white/45">{row.reward_state}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
