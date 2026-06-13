import {
  COURSE_LEVELS,
  SEMESTERS,
  CCMAS_SOURCE_URL,
  type CatalogCourse,
  type CatalogStatus,
  type CourseKind,
  type CourseLevel,
  type Semester,
} from './catalog'

// ─── Curriculum ingestion (§7.6) ─────────────────────────────────────────────
// One discipline at a time: a model grounded in the NUC CCMAS source proposes
// structured courses; we map its self-reported evidence to a verification status
// and persist them. AI can reach national_verified / corroborated / draft — it
// can NEVER set absu_verified (verified=true). The whole pipeline is advisory:
// the human gate (students/course reps in-app) grants truth.
//
// This module is pure + dependency-injected so every path is testable with the
// Anthropic API MOCKED — CI never makes a paid call (spec §7.5).

/** The model labels how well-sourced each row is; we map it to a status. */
type Evidence = 'national_core' | 'multi_source' | 'single_source' | 'conflict'

const EVIDENCE_TO_STATUS: Record<Evidence, CatalogStatus> = {
  national_core: 'national_verified', // appears in the CCMAS doc
  multi_source: 'corroborated', // 2+ independent sources agree
  single_source: 'draft', // one/weak source — needs a human
  conflict: 'draft', // sources disagree — never average into a fake answer
}

function clamp01(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Strip ```json fences and parse; tolerate a model that wraps JSON in prose. */
function looseParse(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    // last resort: grab the first {...} or [...] block
    const m = cleaned.match(/[[{][\s\S]*[\]}]/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

export interface ParseResult {
  rows: CatalogCourse[]
  warnings: string[]
}

/**
 * Validate the model's output into CatalogCourse rows. Pure — no DB, no network.
 * Invalid rows are dropped with a warning; a missing source_url is downgraded to
 * draft (a claim without an authority is never authoritative). NEVER yields
 * absu_verified — that status is reachable only through a human.
 */
export function parseIngestedCourses(raw: unknown, programmeId: string): ParseResult {
  const warnings: string[] = []
  const parsed = looseParse(raw)
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { courses?: unknown[] })?.courses)
      ? (parsed as { courses: unknown[] }).courses
      : []

  if (list.length === 0) warnings.push('no courses parsed from model output')

  const rows: CatalogCourse[] = []
  const seen = new Set<string>()

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>

    const code = asString(r.code)
    const title = asString(r.title)
    const level = r.level as CourseLevel
    const semester = r.semester as Semester
    const kind = asString(r.kind) as CourseKind
    const creditUnits = typeof r.creditUnits === 'number' ? r.creditUnits : Number(r.creditUnits)

    if (!code || !title) {
      warnings.push(`dropped row with missing code/title: ${JSON.stringify(r).slice(0, 80)}`)
      continue
    }
    if (!COURSE_LEVELS.includes(level)) {
      warnings.push(`dropped ${code}: invalid level ${String(r.level)}`)
      continue
    }
    if (!SEMESTERS.includes(semester)) {
      warnings.push(`dropped ${code}: invalid semester ${String(r.semester)}`)
      continue
    }
    if (kind !== 'core' && kind !== 'elective') {
      warnings.push(`dropped ${code}: invalid kind ${String(r.kind)}`)
      continue
    }
    if (!Number.isFinite(creditUnits) || creditUnits < 0) {
      warnings.push(`dropped ${code}: invalid creditUnits ${String(r.creditUnits)}`)
      continue
    }

    const dedupeKey = `${level}:${semester}:${code.toLowerCase()}`
    if (seen.has(dedupeKey)) {
      warnings.push(`dropped duplicate ${code} (${level}/${semester})`)
      continue
    }
    seen.add(dedupeKey)

    const evidence = asString(r.evidence) as Evidence
    let status: CatalogStatus = EVIDENCE_TO_STATUS[evidence] ?? 'draft'
    let confidence = clamp01(r.confidence, status === 'national_verified' ? 0.85 : 0.5)
    const sourceUrl = asString(r.sourceUrl) || asString(r.source_url) || null

    // A claim without a citation can't be authoritative — force draft.
    if (!sourceUrl) {
      if (status !== 'draft') warnings.push(`${code}: no source_url → downgraded to draft`)
      status = 'draft'
      confidence = Math.min(confidence, 0.4)
    }

    rows.push({
      programmeId,
      level,
      semester,
      code,
      title,
      creditUnits,
      kind,
      status, // never 'absu_verified' — humans only
      confidence,
      sourceUrl: sourceUrl ?? CCMAS_SOURCE_URL,
      lastChecked: new Date().toISOString(),
    })
  }

  return { rows, warnings }
}

// ─── Orchestration (dependency-injected) ─────────────────────────────────────

export interface IngestProgramme {
  id: string
  name: string
  facultyName: string
}

export interface IngestDeps {
  /** Kill switch (§7.5). When false, no model call happens. */
  aiEnabled: () => Promise<boolean>
  /** Calls the grounded model and returns its raw JSON/text. Mocked in tests. */
  generate: (programme: IngestProgramme) => Promise<unknown>
  /** Persists rows (upsert). */
  save: (rows: CatalogCourse[]) => Promise<void>
}

export interface IngestResult {
  disabled?: boolean
  programmeId: string
  saved: number
  /** Rows still needing a human (everything not absu_verified — i.e. all of them). */
  reviewQueue: CatalogCourse[]
  warnings: string[]
}

export async function ingestDiscipline(deps: IngestDeps, programme: IngestProgramme): Promise<IngestResult> {
  if (!(await deps.aiEnabled())) {
    return { disabled: true, programmeId: programme.id, saved: 0, reviewQueue: [], warnings: ['AI disabled (kill switch)'] }
  }

  const raw = await deps.generate(programme)
  const { rows, warnings } = parseIngestedCourses(raw, programme.id)
  await deps.save(rows)

  // Nothing AI produces is ever absu_verified, so the entire batch is the human
  // review queue. (Belt-and-suspenders: filter explicitly.)
  const reviewQueue = rows.filter((r) => r.status !== 'absu_verified')
  return { programmeId: programme.id, saved: rows.length, reviewQueue, warnings }
}
