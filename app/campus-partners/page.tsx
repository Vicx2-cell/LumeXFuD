import { PageHeader } from '@/components/ui/page-header'
import { loadCampusPartnerSummary } from '@/lib/campus-partners'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { CampusPartnersClient } from './campus-partners-client'

export const dynamic = 'force-dynamic'

export default async function CampusPartnersPage() {
  const session = await getCurrentUser().catch(() => null)
  let summary = null
  if (session?.userId) {
    const db = createSupabaseAdmin()
    const roleColumn = session.role === 'customer'
      ? 'customer_id'
      : session.role === 'vendor'
        ? 'vendor_id'
        : session.role === 'rider'
          ? 'rider_id'
          : 'admin_id'
    const { data: profile } = await db.from('social_profiles').select('id').eq(roleColumn, session.userId).maybeSingle()
    if (profile?.id) summary = await loadCampusPartnerSummary(String(profile.id)).catch(() => null)
  }

  return (
    <main className="lx-page px-4 py-6 pb-24">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Campus Partner Program"
          subtitle="Applications, approvals, referrals, commissions, leaderboard, and payouts."
          badge="Performance"
          back={false}
        />
        <CampusPartnersClient summary={summary} />
      </div>
    </main>
  )
}
