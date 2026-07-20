import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { getControls } from '@/lib/controls'
import { BottomNav } from '@/components/nav-bottom'
import { ProfileClient } from './profile-client'
import { FaceIdSetup } from '@/components/face-id-setup'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const session = await getCurrentUser()
  if (!session) redirect('/auth?next=/profile')

  const db = createSupabaseAdmin()

  let profile: CustomerProfile | null = null

  if (session.role === 'customer') {
    const { data: customer } = await db
      .from('customers')
      .select('id, name, email, phone, hostel, room_number, dispute_count, login_pin_hash, avatar_url')
      .eq('phone', session.phone)
      .single()

    profile = customer as CustomerProfile | null
    // Whether this account has a login PIN. Google-created accounts don't set one
    // (Google is their sign-in), so we offer them an OPTIONAL "set a PIN" entry
    // instead of the change/remove controls (which require a current PIN). Only
    // the boolean crosses to the client — never the hash.
    const hasPin = !!(customer as { login_pin_hash?: string | null } | null)?.login_pin_hash

    if (customer) {
      // Cosmetic streaks + badges (migration 037). No XP/levels, no money.
      // The super-admin "streaks" flag only gates display — badges keep
      // accruing via the DB trigger regardless, so toggling it on later
      // surfaces the full earned history.
      let streak: StreakData | null = null
      let badges: BadgeItem[] = []

      if (await getFeature('streaks')) {
        const [{ data: streakRow }, { data: badgeRows }] = await Promise.all([
          db
            .from('customer_streaks')
            .select('current_streak_days, best_streak_days')
            .eq('customer_id', customer.id)
            .maybeSingle(),
          db
            .from('customer_badges')
            .select('badge_id, earned_at, badges(name, description, emoji)')
            .eq('customer_id', customer.id)
            .order('earned_at', { ascending: false }),
        ])
        streak = (streakRow as StreakData | null) ?? null
        badges = (badgeRows ?? []) as unknown as BadgeItem[]
      }

      // Support contact set by the super-admin in Controls (empty = hide the card).
      const supportPhone = (await getControls()).support_phone

      return (
        <main className="lx-page pb-24">
          <ProfileClient profile={profile} streak={streak} badges={badges} phone={session.phone} supportPhone={supportPhone} hasPin={hasPin} />
          <BottomNav />
        </main>
      )
    }
  }

  return (
    <main className="lx-page pb-24">
      <div className="max-w-lg mx-auto px-4 py-8 lx-enter">
        <h1 className="text-xl font-bold mb-4">Profile</h1>
        <div className="glass-thin p-5 space-y-1">
          <p className="text-sm text-white/60">Role: <span className="text-white/85 capitalize">{session.role}</span></p>
          <p className="text-sm text-white/60 tabular-nums">{session.phone}</p>
        </div>

        <div className="glass-thin p-4 mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-white/70">Security</h3>
          <FaceIdSetup />
        </div>

        <form action="/api/auth/logout" method="POST" className="mt-6">
          <button type="submit" className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-red-500/20" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
            Sign out
          </button>
        </form>
      </div>
      <BottomNav />
    </main>
  )
}

export interface CustomerProfile {
  id: string
  name: string | null
  email: string | null
  phone: string
  hostel: string | null
  room_number: string | null
  dispute_count: number
  avatar_url: string | null
}

export interface StreakData {
  current_streak_days: number
  best_streak_days: number
}

export interface BadgeItem {
  badge_id: string
  earned_at: string
  badges: { name: string; description: string | null; emoji: string | null } | null
}
