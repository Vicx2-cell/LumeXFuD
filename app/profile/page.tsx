import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
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
      .select('id, name, phone, hostel, room_number, dispute_count')
      .eq('phone', session.phone)
      .single()

    profile = customer as CustomerProfile | null

    if (customer) {
      // Gamification (XP, streaks, badges) was removed from the MVP — those
      // tables no longer exist. Pass empty so the profile renders cleanly.
      return (
        <main className="lx-page pb-24">
          <ProfileClient profile={profile} xp={null} badges={[]} phone={session.phone} />
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
  phone: string
  hostel: string | null
  room_number: string | null
  dispute_count: number
}

export interface XPData {
  total_xp: number
  weekly_xp: number
  level: number
  current_streak_days: number
  best_streak_days: number
  streak_freeze_count: number
}

export interface BadgeItem {
  badge_id: string
  earned_at: string
  badges: { name: string; description: string | null } | null
}
