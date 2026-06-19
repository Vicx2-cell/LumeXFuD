import { createSupabaseAdmin } from './supabase/server'

// Fire-and-forget feature-usage tracking. Increments an aggregate (feature, role)
// counter via the bump_feature_usage RPC (migration 066). Deliberately NOT
// awaited by callers and never throws — analytics must never slow or break a
// real request, and approximate counts are fine for "what's used most".

export type UsageRole = 'customer' | 'vendor' | 'rider' | 'guest'

export function trackFeature(key: string, role: UsageRole): void {
  try {
    const db = createSupabaseAdmin()
    void db.rpc('bump_feature_usage', { p_key: key, p_role: role }).then(
      () => {},
      () => {}, // swallow — table/RPC may not exist yet (migration 066 not run)
    )
  } catch {
    /* never throw */
  }
}
