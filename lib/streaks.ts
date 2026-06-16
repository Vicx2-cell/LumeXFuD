// Streak helpers shared by the home nudge + anywhere else that reasons about a
// customer's streak state. Streaks are CAMPUS-LOCAL calendar days (Africa/Lagos)
// to match the awarding trigger in migration 037 — the same day boundary the DB
// uses, so the UI never disagrees with what was actually awarded.

const LAGOS = 'Africa/Lagos'

/** YYYY-MM-DD for a moment, in Africa/Lagos (Lagos has no DST → stable +01:00). */
export function lagosDate(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which compares lexicographically == chronologically.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export type StreakStatus =
  | 'locked'  // ordered today already — streak safe, came back to flex
  | 'at_risk' // last order was yesterday — order TODAY or the flame dies (the hook)
  | 'reset'   // gap > 1 day — streak already broken, restart today
  | 'none'    // no streak on record

/**
 * Classify a streak from its stored counter + last qualifying day. Mirrors the
 * trigger's day logic so "at_risk" means exactly "one more day keeps current+1,
 * skipping today drops you to 1 on your next order."
 */
export function streakStatus(current: number, lastOrderDate: string | null): StreakStatus {
  if (!lastOrderDate || current <= 0) return 'none'
  const today = lagosDate()
  const yesterday = lagosDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  if (lastOrderDate >= today) return 'locked'
  if (lastOrderDate === yesterday) return 'at_risk'
  return 'reset'
}
