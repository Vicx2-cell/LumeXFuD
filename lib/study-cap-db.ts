import { createSupabaseAdmin } from './supabase/server'
import type { CapStore } from './study-cap'

// Supabase-backed CapStore over study_daily_usage (migration 040).
// NOTE: increment is a read-modify-write, so two truly simultaneous practice
// requests from the same user could over-serve by one. That's an acceptable soft
// limit for a product cap (not money); the atomic version — an INSERT ... ON
// CONFLICT DO UPDATE ... WHERE practice_count < cap RETURNING, exposed as an RPC
// — is a gated migration left to the §7.5 hardening pass.

type DB = ReturnType<typeof createSupabaseAdmin>

export function dbCapStore(db: DB): CapStore {
  return {
    async get(userId, date) {
      const { data } = await db
        .from('study_daily_usage')
        .select('practice_count')
        .eq('user_id', userId)
        .eq('usage_date', date)
        .maybeSingle()
      return data?.practice_count ?? 0
    },
    async increment(userId, date) {
      const { data } = await db
        .from('study_daily_usage')
        .select('practice_count')
        .eq('user_id', userId)
        .eq('usage_date', date)
        .maybeSingle()
      const next = (data?.practice_count ?? 0) + 1
      await db
        .from('study_daily_usage')
        .upsert({ user_id: userId, usage_date: date, practice_count: next }, { onConflict: 'user_id,usage_date' })
    },
  }
}
