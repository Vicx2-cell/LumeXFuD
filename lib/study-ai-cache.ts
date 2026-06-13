import { createSupabaseAdmin } from './supabase/server'
import type { CacheIO, StudyKind } from './study-cache'

// Supabase-backed CacheIO over study_ai_cache (migration 040). Kept out of
// lib/study-cache.ts so the pure cache logic never imports server-only code.
// study_ai_cache is service_role-only (no per-user ownership — the cache is
// shared across all students), so all access is via the admin client.

type DB = ReturnType<typeof createSupabaseAdmin>

export function dbCacheIO<T>(db: DB, opts: { kind: StudyKind; courseId?: string | null }): CacheIO<T> {
  return {
    async get(key) {
      const { data } = await db
        .from('study_ai_cache')
        .select('payload')
        .eq('cache_key', key)
        .maybeSingle()
      return (data?.payload as T | undefined) ?? null
    },
    async set(key, payload, model) {
      await db.from('study_ai_cache').upsert(
        {
          cache_key: key,
          course_id: opts.courseId ?? null,
          kind: opts.kind,
          payload,
          model,
        },
        { onConflict: 'cache_key' },
      )
    },
  }
}
