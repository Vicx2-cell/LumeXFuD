import { createSupabaseAdmin } from './supabase/server'
import type { CatalogCourse } from './catalog'

// Persists ingested rows into study_catalog_courses (migration 040/041).
// `verified` is a generated column (= status = 'absu_verified') — we never write
// it. Upsert keyed on the natural unique (programme_id, level, semester, code).

type DB = ReturnType<typeof createSupabaseAdmin>

export async function saveCatalogCourses(db: DB, rows: CatalogCourse[]): Promise<void> {
  if (rows.length === 0) return
  const payload = rows.map((r) => ({
    programme_id: r.programmeId,
    level: r.level,
    semester: r.semester,
    code: r.code,
    title: r.title,
    credit_units: r.creditUnits,
    kind: r.kind,
    status: r.status,
    confidence: r.confidence,
    source_url: r.sourceUrl,
    last_checked: r.lastChecked,
  }))
  const { error } = await db.from('study_catalog_courses').upsert(payload, { onConflict: 'programme_id,level,semester,code' })
  if (error) throw new Error(`saveCatalogCourses: ${error.message}`)
}
