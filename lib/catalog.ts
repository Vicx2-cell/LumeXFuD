// ─── Course catalog selector (pure logic) ────────────────────────────────────
// Drives the "what am I offering this semester?" selector: a student narrows
// faculty → programme → level → semester, and that selection later keys into the
// CCMAS course catalog and the study tool.
//
// This module is intentionally DB-free and React-free so the whole selection
// state machine is unit-testable (same pattern as lib/demand.ts). The scaffold
// data below is only the dimensions a student picks FROM; the authoritative,
// human-verified course catalog (Section 7.6) arrives via the gated migration +
// ingestion and will replace `FACULTIES` with a queried source. Until then this
// is CCMAS-GUIDED, UNVERIFIED scaffolding — never present it as definitive.

export type CourseLevel = 100 | 200 | 300 | 400 | 500
export type Semester = 1 | 2

export interface Faculty {
  id: string
  name: string
}

export interface Programme {
  id: string
  facultyId: string
  name: string
}

/** A (possibly partial) faculty→programme→level→semester selection. */
export interface CatalogSelection {
  facultyId: string | null
  programmeId: string | null
  level: CourseLevel | null
  semester: Semester | null
}

/** A selection with every dimension chosen — what the next step consumes. */
export interface CompleteSelection {
  facultyId: string
  programmeId: string
  level: CourseLevel
  semester: Semester
}

export const EMPTY_SELECTION: CatalogSelection = {
  facultyId: null,
  programmeId: null,
  level: null,
  semester: null,
}

export const COURSE_LEVELS: readonly CourseLevel[] = [100, 200, 300, 400, 500]
export const SEMESTERS: readonly Semester[] = [1, 2]

// CCMAS-guided, UNVERIFIED scaffold of faculties and their programmes. Kept
// small and obviously placeholder; the gated ingestion (Section 7.6) supplies
// the real, source-cited, human-verified catalog. CHM 213 (Chemistry) and
// BCH 201 (Biochemistry) — the Section 6 seed courses — live under Sciences.
const FACULTIES_SEED: ReadonlyArray<Faculty & { programmes: ReadonlyArray<{ id: string; name: string }> }> = [
  {
    id: 'sciences',
    name: 'Sciences',
    programmes: [
      { id: 'biochemistry', name: 'Biochemistry' },
      { id: 'chemistry', name: 'Chemistry' },
      { id: 'microbiology', name: 'Microbiology' },
      { id: 'computer-science', name: 'Computer Science' },
      { id: 'mathematics', name: 'Mathematics' },
    ],
  },
  {
    id: 'engineering',
    name: 'Engineering',
    programmes: [
      { id: 'mechanical-engineering', name: 'Mechanical Engineering' },
      { id: 'electrical-engineering', name: 'Electrical & Electronics Engineering' },
      { id: 'civil-engineering', name: 'Civil Engineering' },
    ],
  },
  {
    id: 'management-sciences',
    name: 'Management Sciences',
    programmes: [
      { id: 'accounting', name: 'Accounting' },
      { id: 'business-administration', name: 'Business Administration' },
      { id: 'economics', name: 'Economics' },
    ],
  },
]

const FACULTIES: readonly Faculty[] = FACULTIES_SEED.map(({ id, name }) => ({ id, name }))

const PROGRAMMES: readonly Programme[] = FACULTIES_SEED.flatMap((f) =>
  f.programmes.map((p) => ({ id: p.id, facultyId: f.id, name: p.name })),
)

// ─── Lookups ─────────────────────────────────────────────────────────────────

export function listFaculties(): Faculty[] {
  return [...FACULTIES]
}

export function facultyById(id: string | null): Faculty | null {
  if (!id) return null
  return FACULTIES.find((f) => f.id === id) ?? null
}

/** Programmes under a faculty (empty if the faculty is unknown/unset). */
export function programmesForFaculty(facultyId: string | null): Programme[] {
  if (!facultyId) return []
  return PROGRAMMES.filter((p) => p.facultyId === facultyId)
}

export function programmeById(id: string | null): Programme | null {
  if (!id) return null
  return PROGRAMMES.find((p) => p.id === id) ?? null
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function levelLabel(level: CourseLevel): string {
  return `${level} Level`
}

export function semesterLabel(semester: Semester): string {
  return semester === 1 ? 'First Semester' : 'Second Semester'
}

// ─── Selection state machine ─────────────────────────────────────────────────
// Each setter returns a NEW selection (never mutates) and clears anything
// downstream that the change invalidates — picking a different faculty drops the
// previously-chosen programme (which belonged to the old faculty). Level and
// semester are independent dimensions, so they survive a faculty/programme swap.

export function selectFaculty(sel: CatalogSelection, facultyId: string): CatalogSelection {
  if (!facultyById(facultyId)) return sel // ignore unknown faculty
  if (sel.facultyId === facultyId) return sel
  return { ...sel, facultyId, programmeId: null }
}

export function selectProgramme(sel: CatalogSelection, programmeId: string): CatalogSelection {
  const programme = programmeById(programmeId)
  // A programme is only valid once its faculty is the chosen one.
  if (!programme || programme.facultyId !== sel.facultyId) return sel
  return { ...sel, programmeId }
}

export function selectLevel(sel: CatalogSelection, level: CourseLevel): CatalogSelection {
  if (!COURSE_LEVELS.includes(level)) return sel
  return { ...sel, level }
}

export function selectSemester(sel: CatalogSelection, semester: Semester): CatalogSelection {
  if (!SEMESTERS.includes(semester)) return sel
  return { ...sel, semester }
}

export type Step = 'faculty' | 'programme' | 'level' | 'semester' | 'done'

/** The first dimension still missing — the step the UI should be asking for. */
export function currentStep(sel: CatalogSelection): Step {
  if (!sel.facultyId) return 'faculty'
  if (!sel.programmeId) return 'programme'
  if (sel.level == null) return 'level'
  if (sel.semester == null) return 'semester'
  return 'done'
}

/** True (with type narrowing) once every dimension is chosen. */
export function isComplete(sel: CatalogSelection): sel is CatalogSelection & CompleteSelection {
  return currentStep(sel) === 'done'
}

/** A short human summary of a complete selection, e.g. for a confirmation card. */
export function summarize(sel: CompleteSelection): string {
  const faculty = facultyById(sel.facultyId)?.name ?? sel.facultyId
  const programme = programmeById(sel.programmeId)?.name ?? sel.programmeId
  return `${programme} (${faculty}) · ${levelLabel(sel.level)} · ${semesterLabel(sel.semester)}`
}
