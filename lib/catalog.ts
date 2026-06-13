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

/** How sure we are about a seeded row — drives the human-verify gate (§7.6). */
export type Confidence = 'low' | 'medium' | 'high'

export interface Faculty {
  id: string
  /** ABSU calls these "Colleges"; the §7.6 schema names the table `faculties`. */
  name: string
  confidence: Confidence
  /** Authoritative only after human review (§7.6). Seed rows are false. */
  verified: boolean
}

export interface Programme {
  id: string
  facultyId: string
  name: string
  confidence: Confidence
  verified: boolean
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

type SeedProgramme = { id: string; name: string; confidence?: Confidence }
type SeedCollege = {
  id: string
  name: string
  /** Default confidence for this college's departments. */
  programmeConfidence: Confidence
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

// Colleges themselves are well-established (confidence: high) but still
// verified: false until the gated step signs the whole catalog off.
const FACULTIES: readonly Faculty[] = FACULTIES_SEED.map((c) => ({
  id: c.id,
  name: c.name,
  confidence: 'high',
  verified: false,
}))

const PROGRAMMES: readonly Programme[] = FACULTIES_SEED.flatMap((c) =>
  c.programmes.map((p) => ({
    id: p.id,
    facultyId: c.id,
    name: p.name,
    confidence: p.confidence ?? c.programmeConfidence,
    verified: false,
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

export interface CatalogCourse {
  programmeId: string
  level: CourseLevel
  semester: Semester
  /** Course code, e.g. "BCH 201". */
  code: string
  title: string
  creditUnits: number
  kind: CourseKind
  /** Citation for where this row came from (shown in the UI). */
  sourceUrl: string
  /** Authoritative only after human review (§7.6). Scaffold rows are false. */
  verified: boolean
}

/** The national standard these scaffold rows are guided by. */
export const CCMAS_SOURCE_URL = 'https://www.nuc.edu.ng/ccmas/'

// Helper to keep the scaffold terse: every row shares the CCMAS source and is
// unverified until a human signs off.
function scaffold(
  programmeId: string,
  level: CourseLevel,
  semester: Semester,
  rows: ReadonlyArray<[code: string, title: string, creditUnits: number, kind: CourseKind]>,
): CatalogCourse[] {
  return rows.map(([code, title, creditUnits, kind]) => ({
    programmeId,
    level,
    semester,
    code,
    title,
    creditUnits,
    kind,
    sourceUrl: CCMAS_SOURCE_URL,
    verified: false,
  }))
}

// Small, illustrative scaffold around the seed courses (BCH 201, CHM 213).
// Other programmes/levels simply return an empty list until ingestion fills them.
const COURSE_SCAFFOLD: readonly CatalogCourse[] = [
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

/** Courses a student at this programme/level/semester should be offering. */
export function coursesFor(programmeId: string, level: CourseLevel, semester: Semester): CatalogCourse[] {
  return COURSE_SCAFFOLD.filter(
    (c) => c.programmeId === programmeId && c.level === level && c.semester === semester,
  )
}

/** Total credit units across a set of courses (for the browse-view summary). */
export function totalCreditUnits(courses: ReadonlyArray<CatalogCourse>): number {
  return courses.reduce((sum, c) => sum + c.creditUnits, 0)
}
