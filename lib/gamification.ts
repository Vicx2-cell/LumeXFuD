import { createSupabaseAdmin } from './supabase/server'

const XP_ACTIONS = {
  ORDER_COMPLETED: 20,
  RATING_SUBMITTED: 5,
  STREAK_BONUS: 10,
  FIRST_ORDER: 50,
} as const

export async function awardXP(
  customerId: string,
  action: keyof typeof XP_ACTIONS
): Promise<void> {
  const db = createSupabaseAdmin()
  const xp = XP_ACTIONS[action]

  const { data: existing } = await db
    .from('customer_xp')
    .select('total_xp, weekly_xp, level')
    .eq('customer_id', customerId)
    .single()

  const newTotal = ((existing?.total_xp as number) ?? 0) + xp
  const newWeekly = ((existing?.weekly_xp as number) ?? 0) + xp
  const newLevel = calcLevel(newTotal)

  await db
    .from('customer_xp')
    .upsert(
      {
        customer_id: customerId,
        total_xp: newTotal,
        weekly_xp: newWeekly,
        level: newLevel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id' }
    )
}

export async function updateStreak(customerId: string): Promise<number> {
  const db = createSupabaseAdmin()
  const today = new Date().toISOString().split('T')[0]

  const { data: xpRow } = await db
    .from('customer_xp')
    .select('current_streak_days, best_streak_days, last_order_date')
    .eq('customer_id', customerId)
    .single()

  const lastOrderDate = (xpRow?.last_order_date as string) ?? null
  const currentStreak = (xpRow?.current_streak_days as number) ?? 0
  const bestStreak = (xpRow?.best_streak_days as number) ?? 0

  let newStreak = 1
  if (lastOrderDate) {
    const last = new Date(lastOrderDate)
    const now = new Date(today)
    const diffDays = Math.floor((now.getTime() - last.getTime()) / 86400000)
    if (diffDays === 1) {
      newStreak = currentStreak + 1
    } else if (diffDays === 0) {
      newStreak = currentStreak
    }
  }

  await db
    .from('customer_xp')
    .upsert(
      {
        customer_id: customerId,
        current_streak_days: newStreak,
        best_streak_days: Math.max(bestStreak, newStreak),
        last_order_date: today,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id' }
    )

  return newStreak
}

function calcLevel(totalXp: number): number {
  if (totalXp < 100) return 1
  if (totalXp < 300) return 2
  if (totalXp < 600) return 3
  if (totalXp < 1000) return 4
  if (totalXp < 1500) return 5
  if (totalXp < 2500) return 6
  if (totalXp < 4000) return 7
  if (totalXp < 6000) return 8
  if (totalXp < 9000) return 9
  return 10
}
