import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BottomNav } from '@/components/nav-bottom'
import { ProfileClient } from './profile-client'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const session = await getCurrentUser()
  if (!session) redirect('/auth?next=/profile')

  const db = createSupabaseAdmin()

  let profile: CustomerProfile | null = null
  let xp: XPData | null = null

  if (session.role === 'customer') {
    const { data: customer } = await db
      .from('customers')
      .select('id, name, phone, hostel, room_number, dispute_count')
      .eq('phone', session.phone)
      .single()

    profile = customer as CustomerProfile | null

    if (customer) {
      const { data: xpData } = await db
        .from('customer_xp')
        .select('total_xp, weekly_xp, level, current_streak_days, best_streak_days, streak_freeze_count')
        .eq('customer_id', customer.id)
        .single()
      xp = xpData as XPData | null

      const { data: badges } = await db
        .from('customer_badges')
        .select('badge_id, earned_at, badges(name, description)')
        .eq('customer_id', customer.id)
        .order('earned_at', { ascending: false })

      return (
        <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
          <ProfileClient profile={profile} xp={xp} badges={(badges ?? []) as unknown as BadgeItem[]} phone={session.phone} />
          <BottomNav />
        </main>
      )
    }
  }

  return (
    <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-4">Profile</h1>
        <p className="text-sm text-white/60">Role: {session.role}</p>
        <p className="text-sm text-white/60 mt-1">{session.phone}</p>
        <form action="/api/auth/logout" method="POST" className="mt-6">
          <button type="submit" className="px-5 py-2.5 rounded-xl text-sm font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
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
