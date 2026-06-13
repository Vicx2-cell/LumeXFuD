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

// Verification status — a claim matched against an authority, never a naked
// boolean. Two engines: the CCMAS national core is AI-verifiable; the ABSU 30%
// (exact codes/units/semester) can only be confirmed by an ABSU human.
//   national_verified — appears in the CCMAS doc. AI may set. High confidence.
//   corroborated      — 2+ independent sources agree exactly. AI may set.
//   draft             — single/weak source or any conflict. AI may set. Needs human.
//   absu_verified     — confirmed by an ABSU authority/human. ONLY a human sets this.
// RULE: verified=true is reachable ONLY via absu_verified — AI/seed can never grant it.
export type CatalogStatus = 'national_verified' | 'corroborated' | 'draft' | 'absu_verified'

/** Provenance carried by every catalog row. */
export interface SourceMeta {
  status: CatalogStatus
  /** 0–1. AI raises confidence; only a human grants truth (absu_verified). */
  confidence: number
  sourceUrl: string | null
  /** ISO timestamp the row was last checked against its source (null = seed). */
  lastChecked: string | null
}

/** The single integrity check: a row is truly verified only if a human confirmed it. */
export function isVerified(status: CatalogStatus): boolean {
  return status === 'absu_verified'
}

export interface Faculty extends SourceMeta {
  id: string
  /** ABSU calls these "Colleges"; the §7.6 schema names the table `faculties`. */
  name: string
}

export interface Programme extends SourceMeta {
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

// Seed-only confidence labels (mapped to a 0–1 score by the builder below).
type SeedConfidence = 'medium' | 'low'
type SeedProgramme = { id: string; name: string }
type SeedCollege = {
  id: string
  name: string
  /** Default confidence for this college's departments. */
  programmeConfidence: SeedConfidence
  programmes: ReadonlyArray<SeedProgramme>
}

// ABSU colleges → departments, transcribed from the human-supplied catalog
// (2026-06). Departments default to `medium` confidence; Engineering &
// Environmental Studies and Medicine & Health Sciences are `low` because those
// groupings vary by source and must be confirmed by the gated human-verify step
// (§7.6) before any row is marked authoritative. Everything here is
// verified: false — UNVERIFIED, never present as the definitive ABSU list.
// Postgraduate is intentionally omitted (the study tool is levels 100–500).
const FACULTIES_SEED: ReadonlyArray<SeedCollege> = [
  {
    id: 'agriculture-veterinary',
    name: 'Agriculture & Veterinary Medicine',
    programmeConfidence: 'medium',
    programmes: [
      { id: 'agricultural-economics-extension', name: 'Agricultural Economics & Extension' },
      { id: 'animal-science-fisheries', name: 'Animal Science & Fisheries' },
      { id: 'crop-production-protection', name: 'Crop Production & Protection / Agronomy' },
      { id: 'soil-science', name: 'Soil Science' },
      { id: 'food-science-technology', name: 'Food Science & Technology' },
      { id: 'forestry', name: 'Forestry' },
      { id: 'veterinary-medicine', name: 'Veterinary Medicine' },
    ],
  },
  {
    id: 'biological-physical-sciences',
    name: 'Biological & Physical Sciences',
    programmeConfidence: 'medium',
    programmes: [
      { id: 'biochemistry', name: 'Biochemistry' },
      { id: 'microbiology', name: 'Microbiology' },
      { id: 'animal-environmental-biology', name: 'Animal & Environmental Biology (Zoology)' },
      { id: 'plant-science-biotechnology', name: 'Plant Science & Biotechnology (Botany)' },
      { id: 'chemistry', name: 'Industrial Chemistry / Chemistry' },
      { id: 'physics', name: 'Physics / Applied Physics' },
      { id: 'computer-science', name: 'Computer Science' },
      { id: 'mathematics', name: 'Mathematics' },
      { id: 'statistics', name: 'Statistics' },
      { id: 'geology', name: 'Geology' },
    ],
  },
  {
    id: 'business-administration',
    name: 'Business Administration',
    programmeConfidence: 'medium',
    programmes: [
      { id: 'accountancy', name: 'Accountancy' },
      { id: 'banking-finance', name: 'Banking & Finance' },
      { id: 'economics', name: 'Economics' },
      { id: 'management', name: 'Management' },
      { id: 'marketing', name: 'Marketing' },
    ],
  },
  {
    id: 'education',
    name: 'Education',
    programmeConfidence: 'medium',
    programmes: [
      { id: 'curriculum-teaching', name: 'Curriculum & Teaching / Education' },
      { id: 'educational-administration-planning', name: 'Educational Administration & Planning' },
      { id: 'educational-foundations', name: 'Educational Foundations' },
      { id: 'psychological-foundations', name: 'Psychological Foundations' },
      { id: 'science-education', name: 'Science Education' },
      { id: 'vocational-education', name: 'Vocational Education' },
    ],
  },
  {
    id: 'engineering-environmental',
    name: 'Engineering & Environmental Studies',
    programmeConfidence: 'low', // groupings vary by source — verify before authoritative
    programmes: [
      { id: 'agricultural-engineering', name: 'Agricultural Engineering' },
      { id: 'civil-engineering', name: 'Civil Engineering' },
      { id: 'chemical-engineering', name: 'Chemical Engineering' },
      { id: 'computer-engineering', name: 'Computer Engineering' },
      { id: 'electrical-electronic-engineering', name: 'Electrical/Electronic Engineering' },
      { id: 'mechanical-engineering', name: 'Mechanical Engineering' },
      { id: 'marine-engineering', name: 'Marine Engineering' },
      { id: 'petroleum-gas-engineering', name: 'Petroleum & Gas Engineering' },
      { id: 'metallurgical-materials-engineering', name: 'Metallurgical & Materials Engineering' },
      { id: 'production-industrial-engineering', name: 'Production & Industrial Engineering' },
      { id: 'systems-engineering', name: 'Systems Engineering' },
      { id: 'ict', name: 'Information & Communication Technology' },
      { id: 'surveying-geoinformatics', name: 'Surveying & Geo-Informatics' },
      { id: 'architecture', name: 'Architecture' },
      { id: 'building', name: 'Building' },
      { id: 'estate-management', name: 'Estate Management' },
      { id: 'quantity-surveying', name: 'Quantity Surveying' },
      { id: 'urban-regional-planning', name: 'Urban & Regional Planning' },
      { id: 'geography-planning', name: 'Geography & Planning' },
      { id: 'environmental-resource-management', name: 'Environmental Resource Management' },
      { id: 'fine-applied-arts', name: 'Fine & Applied Arts' },
    ],
  },
  {
    id: 'humanities-social-sciences',
    name: 'Humanities & Social Sciences',
    programmeConfidence: 'medium',
    programmes: [
      { id: 'english-language-literature', name: 'English Language & Literature' },
      { id: 'linguistics-communications-igbo', name: 'Linguistics, Communications & Igbo Studies' },
      { id: 'history-international-relations', name: 'History & International Relations' },
      { id: 'religious-studies-philosophy', name: 'Religious Studies & Philosophy' },
      { id: 'foreign-languages-translation', name: 'Foreign Languages & Translation Studies' },
      { id: 'political-science', name: 'Political Science' },
      { id: 'sociology', name: 'Sociology' },
      { id: 'mass-communication', name: 'Mass Communication' },
      { id: 'library-information-science', name: 'Library & Information Science' },
    ],
  },
  {
    id: 'law',
    name: 'Law',
    programmeConfidence: 'medium',
    programmes: [{ id: 'law', name: 'Law' }],
  },
  {
    id: 'medicine-health-sciences',
    name: 'Medicine & Health Sciences',
    programmeConfidence: 'low', // basic/clinical/health groupings vary — verify before authoritative
    programmes: [
      { id: 'human-anatomy', name: 'Human Anatomy' },
      { id: 'human-physiology', name: 'Human Physiology' },
      { id: 'medical-biochemistry', name: 'Medical Biochemistry' },
      { id: 'medicine', name: 'Medicine' },
      { id: 'surgery', name: 'Surgery' },
      { id: 'obstetrics-gynaecology', name: 'Obstetrics & Gynaecology' },
      { id: 'paediatrics', name: 'Paediatrics' },
      { id: 'pathology', name: 'Pathology' },
      { id: 'pharmacology', name: 'Pharmacology' },
      { id: 'community-medicine', name: 'Community Medicine' },
      { id: 'medical-laboratory-science', name: 'Medical Laboratory Science' },
      { id: 'nursing-science', name: 'Nursing Science' },
      { id: 'public-health', name: 'Public Health' },
      { id: 'physiotherapy', name: 'Physiotherapy / Medical Rehabilitation' },
      { id: 'radiography', name: 'Radiography' },
      { id: 'medicine-surgery-mbbs', name: 'Medicine & Surgery (MBBS)' },
      { id: 'dentistry', name: 'Dentistry' },
    ],
  },
  {
    id: 'optometry',
    name: 'Optometry',
    programmeConfidence: 'medium',
    programmes: [{ id: 'optometry', name: 'Optometry' }],
  },
]

const SEED_CONFIDENCE: Record<SeedConfidence, number> = { medium: 0.7, low: 0.45 }

// College/department structure is ABSU-specific, so it can only ever be
// `absu_verified` by a human — the seed lands as `draft`. Colleges are
// well-known (high confidence) but still draft until confirmed.
const FACULTIES: readonly Faculty[] = FACULTIES_SEED.map((c) => ({
  id: c.id,
  name: c.name,
  status: 'draft',
  confidence: 0.85,
  sourceUrl: null,
  lastChecked: null,
}))

const PROGRAMMES: readonly Programme[] = FACULTIES_SEED.flatMap((c) =>
  c.programmes.map((p) => ({
    id: p.id,
    facultyId: c.id,
    name: p.name,
    status: 'draft',
    confidence: SEED_CONFIDENCE[c.programmeConfidence],
    sourceUrl: null,
    lastChecked: null,
  })),
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

// ─── Course catalog (CCMAS-guided scaffold) ──────────────────────────────────
// Mirrors the §7.6 `catalog_courses` shape so the browse view renders the real
// thing. Every scaffold row is UNVERIFIED (verified: false) and carries its
// source — the UI must show the CCMAS citation and never present these as the
// definitive ABSU list. The gated ingestion (§7.6) replaces this with
// source-cited, human-verified rows.

export type CourseKind = 'core' | 'elective'

export interface CatalogCourse extends SourceMeta {
  programmeId: string
  level: CourseLevel
  semester: Semester
  /** Course code, e.g. "BCH 201". */
  code: string
  title: string
  creditUnits: number
  kind: CourseKind
}

/** The national standard these scaffold rows are guided by (publishes per discipline). */
export const CCMAS_SOURCE_URL = 'https://nuc-ccmas.ng'

// Helper to keep the scaffold terse. Hand-seeded discipline rows are always
// `draft` (single, illustrative source — the ABSU code/unit/semester must be
// human-confirmed); confidence defaults to 0.5 (raise it for sturdier rows).
function scaffold(
  programmeId: string,
  level: CourseLevel,
  semester: Semester,
  rows: ReadonlyArray<[code: string, title: string, creditUnits: number, kind: CourseKind]>,
  confidence = 0.5,
): CatalogCourse[] {
  return rows.map(([code, title, creditUnits, kind]) => ({
    programmeId,
    level,
    semester,
    code,
    title,
    creditUnits,
    kind,
    status: 'draft',
    confidence,
    sourceUrl: CCMAS_SOURCE_URL,
    lastChecked: null,
  }))
}

// ✓ CCMAS national core — compulsory for EVERY programme (GST/ENT). These appear
// in the published CCMAS document, so they're `national_verified` (AI-settable,
// high confidence) — but never `absu_verified`, since the exact ABSU code/semester
// still needs a human. Placement follows the worked Biochemistry track (§3).
type NationalCore = { level: CourseLevel; semester: Semester; code: string; title: string; creditUnits: number }
const NATIONAL_CORE: readonly NationalCore[] = [
  { level: 100, semester: 1, code: 'GST 111', title: 'Communication in English', creditUnits: 2 },
  { level: 100, semester: 2, code: 'GST 112', title: 'Nigerian Peoples and Culture', creditUnits: 2 },
  { level: 200, semester: 1, code: 'GST 212', title: 'Philosophy, Logic and Human Existence', creditUnits: 2 },
  { level: 200, semester: 2, code: 'ENT 211', title: 'Entrepreneurship and Innovation', creditUnits: 2 },
  { level: 300, semester: 1, code: 'ENT 312', title: 'Venture Creation', creditUnits: 2 },
]

// Small, illustrative scaffold around the seed courses (BCH 201, CHM 213).
// Other programmes/levels simply return an empty list until ingestion fills them.
const COURSE_SCAFFOLD: readonly CatalogCourse[] = [
  // Biochemistry 100 — standardised CCMAS science foundation (✓ pattern; codes
  // to confirm, so 'high' confidence on the shape).
  ...scaffold('biochemistry', 100, 1, [
    ['CHM 101', 'General Chemistry I (Physical/Inorganic)', 2, 'core'],
    ['BIO 101', 'General Biology I', 2, 'core'],
    ['PHY 101', 'General Physics I (Mechanics)', 2, 'core'],
    ['MTH 101', 'Elementary Mathematics I (Algebra & Trigonometry)', 2, 'core'],
    ['CHM 107', 'General Chemistry Practical I', 1, 'core'],
    ['PHY 107', 'General Physics Practical I', 1, 'core'],
  ], 0.65),
  ...scaffold('biochemistry', 100, 2, [
    ['CHM 102', 'General Chemistry II (Organic)', 2, 'core'],
    ['BIO 102', 'General Biology II', 2, 'core'],
    ['PHY 102', 'General Physics II (Electricity & Magnetism)', 2, 'core'],
    ['MTH 102', 'Elementary Mathematics II (Calculus)', 2, 'core'],
    ['STA 111', 'Descriptive Statistics', 2, 'core'],
  ], 0.65),
  ...scaffold('biochemistry', 200, 1, [
    ['BCH 201', 'General Biochemistry I', 3, 'core'],
    ['BCH 203', 'Chemistry of Biomolecules', 2, 'core'],
    ['CHM 201', 'Physical Chemistry I', 2, 'core'],
    ['GST 201', 'Entrepreneurship & Innovation', 2, 'elective'],
  ]),
  ...scaffold('biochemistry', 200, 2, [
    ['BCH 202', 'General Biochemistry II', 3, 'core'],
    ['BCH 204', 'Enzymology', 2, 'core'],
    ['STA 202', 'Statistics for Biological Sciences', 2, 'elective'],
  ]),
  ...scaffold('chemistry', 200, 1, [
    ['CHM 211', 'Physical Chemistry I', 3, 'core'],
    ['CHM 213', 'Inorganic Chemistry I', 2, 'core'],
    ['CHM 215', 'Organic Chemistry I', 3, 'core'],
    ['MTH 211', 'Mathematical Methods', 2, 'elective'],
  ]),
  ...scaffold('chemistry', 200, 2, [
    ['CHM 212', 'Physical Chemistry II', 3, 'core'],
    ['CHM 214', 'Inorganic Chemistry II', 2, 'core'],
    ['CHM 216', 'Organic Chemistry II', 3, 'core'],
  ]),
]

/**
 * Courses a student at this programme/level/semester should be offering: the
 * CCMAS national core (shared by every programme) first, then the discipline's
 * own courses — with any discipline row that duplicates a core code dropped.
 */
export function coursesFor(programmeId: string, level: CourseLevel, semester: Semester): CatalogCourse[] {
  const core: CatalogCourse[] = NATIONAL_CORE.filter((c) => c.level === level && c.semester === semester).map(
    (c) => ({
      programmeId,
      level,
      semester,
      code: c.code,
      title: c.title,
      creditUnits: c.creditUnits,
      kind: 'core',
      status: 'national_verified',
      confidence: 0.9,
      sourceUrl: CCMAS_SOURCE_URL,
      lastChecked: null,
    }),
  )
  const coreCodes = new Set(core.map((c) => c.code))
  const discipline = COURSE_SCAFFOLD.filter(
    (c) => c.programmeId === programmeId && c.level === level && c.semester === semester && !coreCodes.has(c.code),
  )
  return [...core, ...discipline]
}

/** Total credit units across a set of courses (for the browse-view summary). */
export function totalCreditUnits(courses: ReadonlyArray<CatalogCourse>): number {
  return courses.reduce((sum, c) => sum + c.creditUnits, 0)
}
