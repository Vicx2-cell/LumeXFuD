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
