import crypto from 'crypto'

// ─── AI response cache key (§7.2) ────────────────────────────────────────────
// The cost lever: an explanation/practice set for a concept is generated once
// and reused for every student. Two requests collide on the cache only if they
// normalise to the same concept, so "First Law of Thermodynamics!" and
// "  first law of  thermodynamics " share one key (and one paid generation).
//
// Pure + DB-free so it is unit-testable and identical on every call path. The
// actual store/lookup against study_ai_cache lands once migration 040 is approved.

export type StudyKind = 'ask' | 'practice'

const CACHE_VERSION = 'v1'

/**
 * Normalise a free-text concept: lowercase, strip punctuation to spaces, collapse
 * whitespace, trim. Unicode-aware so accented topic names survive.
 */
export function normalizeConcept(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation/symbols → space (don't glue words)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deterministic cache key: sha256(course_code : kind : normalisedConcept : v1).
 * The course code is lowercased/trimmed too so "CHM 213" and "chm 213" collide.
 * Bump CACHE_VERSION to invalidate every cached payload at once.
 */
export function cacheKey(courseCode: string, kind: StudyKind, concept: string): string {
  const course = courseCode.trim().toLowerCase().replace(/\s+/g, ' ')
  const parts = [course, kind, normalizeConcept(concept), CACHE_VERSION].join(':')
  return crypto.createHash('sha256').update(parts).digest('hex')
}

// ─── Cache-first orchestration (§7.2) ────────────────────────────────────────
// Pluggable IO so the "never call a paid model when the cache can answer" rule is
// unit-testable without a DB. The Supabase adapter lives in lib/study-ai-cache.ts
// (kept separate so importing this pure module never pulls in server-only code).

export interface CacheIO<T> {
  get: (key: string) => Promise<T | null>
  set: (key: string, payload: T, model: string | null) => Promise<void>
}

export interface CacheResult<T> {
  payload: T
  /** True when served from cache (no model call happened). */
  cached: boolean
}

/**
 * Return the stored payload on a HIT WITHOUT calling `generate`; on a MISS call
 * `generate` exactly once, store it, and return it. This is the single choke
 * point that guarantees a cache hit never costs a model call.
 */
export async function withCache<T>(
  courseCode: string,
  kind: StudyKind,
  concept: string,
  io: CacheIO<T>,
  generate: () => Promise<{ payload: T; model: string | null }>,
): Promise<CacheResult<T>> {
  const key = cacheKey(courseCode, kind, concept)
  const hit = await io.get(key)
  if (hit !== null) return { payload: hit, cached: true }

  const { payload, model } = await generate()
  await io.set(key, payload, model)
  return { payload, cached: false }
}
