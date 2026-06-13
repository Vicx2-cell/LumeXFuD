import { describe, it, expect, vi } from 'vitest'
import { parseIngestedCourses, ingestDiscipline, type IngestDeps, type IngestProgramme } from './study-ingest'
import { isVerified, type CatalogCourse } from './catalog'

const PROG: IngestProgramme = { id: 'biochemistry', name: 'Biochemistry', facultyName: 'Biological & Physical Sciences' }

function modelOutput(courses: unknown[]): string {
  // The model is prompted for JSON; wrap in a fence to exercise loose parsing.
  return '```json\n' + JSON.stringify({ courses }) + '\n```'
}

describe('parseIngestedCourses', () => {
  it('maps evidence to status and never yields absu_verified', () => {
    const raw = modelOutput([
      { code: 'GST 111', title: 'Communication in English', level: 100, semester: 1, creditUnits: 2, kind: 'core', evidence: 'national_core', sourceUrl: 'https://nuc-ccmas.ng/x', confidence: 0.95 },
      { code: 'BCH 201', title: 'General Biochemistry I', level: 200, semester: 1, creditUnits: 3, kind: 'core', evidence: 'multi_source', sourceUrl: 'https://a.example', confidence: 0.7 },
      { code: 'BCH 299', title: 'Some Elective', level: 200, semester: 2, creditUnits: 2, kind: 'elective', evidence: 'single_source', sourceUrl: 'https://b.example', confidence: 0.5 },
      { code: 'BCH 300', title: 'Conflicted', level: 300, semester: 1, creditUnits: 3, kind: 'core', evidence: 'conflict', sourceUrl: 'https://c.example', confidence: 0.3 },
    ])
    const { rows } = parseIngestedCourses(raw, 'biochemistry')
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]))
    expect(byCode['GST 111'].status).toBe('national_verified')
    expect(byCode['BCH 201'].status).toBe('corroborated')
    expect(byCode['BCH 299'].status).toBe('draft')
    expect(byCode['BCH 300'].status).toBe('draft')
    // The integrity rule: AI can never produce a verified row.
    expect(rows.every((r) => r.status !== 'absu_verified')).toBe(true)
    expect(rows.every((r) => isVerified(r.status) === false)).toBe(true)
    expect(rows.every((r) => r.programmeId === 'biochemistry')).toBe(true)
  })

  it('downgrades a sourceless row to draft regardless of claimed evidence', () => {
    const raw = modelOutput([
      { code: 'BCH 201', title: 'General Biochemistry I', level: 200, semester: 1, creditUnits: 3, kind: 'core', evidence: 'national_core', confidence: 0.9 },
    ])
    const { rows, warnings } = parseIngestedCourses(raw, 'biochemistry')
    expect(rows[0].status).toBe('draft')
    expect(rows[0].confidence).toBeLessThanOrEqual(0.4)
    expect(warnings.some((w) => w.includes('no source_url'))).toBe(true)
  })

  it('drops invalid rows (bad level/semester/kind/units, missing code) with warnings', () => {
    const raw = modelOutput([
      { code: 'X 1', title: 'bad level', level: 150, semester: 1, creditUnits: 2, kind: 'core', sourceUrl: 'https://a' },
      { code: 'X 2', title: 'bad sem', level: 200, semester: 3, creditUnits: 2, kind: 'core', sourceUrl: 'https://a' },
      { code: 'X 3', title: 'bad kind', level: 200, semester: 1, creditUnits: 2, kind: 'major', sourceUrl: 'https://a' },
      { code: 'X 4', title: 'bad units', level: 200, semester: 1, creditUnits: -1, kind: 'core', sourceUrl: 'https://a' },
      { title: 'no code', level: 200, semester: 1, creditUnits: 2, kind: 'core', sourceUrl: 'https://a' },
    ])
    const { rows, warnings } = parseIngestedCourses(raw, 'biochemistry')
    expect(rows).toHaveLength(0)
    expect(warnings.length).toBeGreaterThanOrEqual(5)
  })

  it('dedupes by level/semester/code', () => {
    const raw = modelOutput([
      { code: 'BCH 201', title: 'A', level: 200, semester: 1, creditUnits: 3, kind: 'core', evidence: 'national_core', sourceUrl: 'https://a' },
      { code: 'bch 201', title: 'A dup', level: 200, semester: 1, creditUnits: 3, kind: 'core', evidence: 'national_core', sourceUrl: 'https://a' },
    ])
    const { rows } = parseIngestedCourses(raw, 'biochemistry')
    expect(rows).toHaveLength(1)
  })

  it('coerces string level/semester/units and lowercases kind', () => {
    const raw = modelOutput([
      { code: 'BCH 201', title: 'General Biochemistry I', level: '200', semester: '1', creditUnits: '3', kind: 'Core', evidence: 'national_core', sourceUrl: 'https://a' },
    ])
    const { rows } = parseIngestedCourses(raw, 'biochemistry')
    expect(rows).toHaveLength(1)
    expect(rows[0].level).toBe(200)
    expect(rows[0].semester).toBe(1)
    expect(rows[0].creditUnits).toBe(3)
    expect(rows[0].kind).toBe('core')
  })

  it('returns empty + warning on unparseable output', () => {
    const { rows, warnings } = parseIngestedCourses('the model rambled with no json', 'biochemistry')
    expect(rows).toHaveLength(0)
    expect(warnings.some((w) => w.includes('no courses'))).toBe(true)
  })
})

describe('ingestDiscipline', () => {
  it('does NOT call the model when the kill switch is off', async () => {
    const deps: IngestDeps = {
      aiEnabled: vi.fn(async () => false),
      generate: vi.fn(async () => modelOutput([])),
      save: vi.fn(async () => {}),
    }
    const res = await ingestDiscipline(deps, PROG)
    expect(res.disabled).toBe(true)
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('generates once, saves, and returns the full batch as the human review queue', async () => {
    const saved: CatalogCourse[][] = []
    const deps: IngestDeps = {
      aiEnabled: async () => true,
      generate: vi.fn(async () =>
        modelOutput([
          { code: 'GST 111', title: 'Communication in English', level: 100, semester: 1, creditUnits: 2, kind: 'core', evidence: 'national_core', sourceUrl: 'https://nuc-ccmas.ng' },
          { code: 'BCH 201', title: 'General Biochemistry I', level: 200, semester: 1, creditUnits: 3, kind: 'core', evidence: 'single_source', sourceUrl: 'https://x' },
        ]),
      ),
      save: async (rows) => {
        saved.push(rows)
      },
    }
    const res = await ingestDiscipline(deps, PROG)
    expect(deps.generate).toHaveBeenCalledTimes(1)
    expect(res.saved).toBe(2)
    expect(saved[0]).toHaveLength(2)
    // Everything AI produced still needs a human → all of it is in the queue.
    expect(res.reviewQueue).toHaveLength(2)
    expect(res.reviewQueue.every((r) => r.status !== 'absu_verified')).toBe(true)
  })
})
