// ─── Daily free-practice cap (§7.3) ──────────────────────────────────────────
// The business model: practice questions are capped per user per day; ₦1,000
// removes it later. The cap counts every practice question SERVED (cache hit or
// miss) — it's a product/value limit, not just a cost limit (the cache handles
// cost). Enforced entirely server-side; clients never decide this.
//
// Pure logic + a pluggable store so the "blocks the 6th request" guarantee is
// unit-testable without a DB. The Supabase adapter lives in lib/study-cap-db.ts.

export const FREE_PRACTICE_CAP = 5

const HOUR_MS = 3_600_000

/** Africa/Lagos calendar day (fixed UTC+1, no DST) as YYYY-MM-DD — the cap window. */
export function lagosDate(nowMs: number): string {
  return new Date(nowMs + HOUR_MS).toISOString().slice(0, 10)
}

export interface CapStore {
  /** Practice questions already served to this user today (0 if no row). */
  get: (userId: string, date: string) => Promise<number>
  /** Atomically/idempotently record one more served practice question. */
  increment: (userId: string, date: string) => Promise<void>
}

export interface CapResult {
  allowed: boolean
  /** Questions left today after this call (0 when blocked). */
  remaining: number
  cap: number
}

/**
 * Decide-and-consume one practice question. If the user is already at the cap,
 * returns { allowed: false } WITHOUT incrementing (and the caller must NOT call
 * the model); otherwise records the use and allows it.
 */
export async function consumePractice(
  store: CapStore,
  userId: string,
  nowMs: number,
  cap: number = FREE_PRACTICE_CAP,
): Promise<CapResult> {
  const date = lagosDate(nowMs)
  const used = await store.get(userId, date)
  if (used >= cap) return { allowed: false, remaining: 0, cap }

  await store.increment(userId, date)
  return { allowed: true, remaining: Math.max(0, cap - (used + 1)), cap }
}
