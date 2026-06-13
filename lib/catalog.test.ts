import { describe, it, expect } from 'vitest'
import {
  EMPTY_SELECTION,
  COURSE_LEVELS,
  SEMESTERS,
  listFaculties,
  programmesForFaculty,
  programmeById,
  selectFaculty,
  selectProgramme,
  selectLevel,
  selectSemester,
  currentStep,
  isComplete,
  summarize,
  levelLabel,
  semesterLabel,
  coursesFor,
  totalCreditUnits,
  CCMAS_SOURCE_URL,
  type CatalogSelection,
} from './catalog'

describe('catalog scaffold', () => {
  it('exposes the five academic levels and two semesters', () => {
    expect(COURSE_LEVELS).toEqual([100, 200, 300, 400, 500])
    expect(SEMESTERS).toEqual([1, 2])
  })

  it('lists faculties and only the programmes under a given faculty', () => {
    const faculties = listFaculties()
    expect(faculties.length).toBeGreaterThan(0)

    const sciences = programmesForFaculty('biological-physical-sciences')
    expect(sciences.length).toBeGreaterThan(0)
    expect(sciences.every((p) => p.facultyId === 'biological-physical-sciences')).toBe(true)
    // Biochemistry/Chemistry (the seed-course programmes) live under Sciences.
    expect(sciences.map((p) => p.id)).toContain('biochemistry')
    expect(sciences.map((p) => p.id)).toContain('chemistry')
  })

  it('returns no programmes for an unknown or unset faculty', () => {
    expect(programmesForFaculty('does-not-exist')).toEqual([])
    expect(programmesForFaculty(null)).toEqual([])
  })

  it('has globally unique faculty and programme ids', () => {
    const facultyIds = listFaculties().map((f) => f.id)
    expect(new Set(facultyIds).size).toBe(facultyIds.length)

    // A duplicate programme id would make programmeById/selectProgramme resolve
    // the wrong department — guard the ~75-row hand-entered ABSU seed.
    const programmeIds = listFaculties().flatMap((f) => programmesForFaculty(f.id)).map((p) => p.id)
    expect(new Set(programmeIds).size).toBe(programmeIds.length)
  })

  it('seeds every row as unverified with a confidence (human-verify gate, §7.6)', () => {
    const programmes = listFaculties().flatMap((f) => programmesForFaculty(f.id))
    expect(programmes.every((p) => p.verified === false)).toBe(true)
    expect(programmes.every((p) => ['low', 'medium', 'high'].includes(p.confidence))).toBe(true)
    expect(listFaculties().every((f) => f.verified === false)).toBe(true)
  })
})

describe('selection state machine', () => {
  it('walks faculty → programme → level → semester → done', () => {
    let sel: CatalogSelection = EMPTY_SELECTION
    expect(currentStep(sel)).toBe('faculty')

    sel = selectFaculty(sel, 'biological-physical-sciences')
    expect(currentStep(sel)).toBe('programme')

    sel = selectProgramme(sel, 'biochemistry')
    expect(currentStep(sel)).toBe('level')

    sel = selectLevel(sel, 200)
    expect(currentStep(sel)).toBe('semester')

    sel = selectSemester(sel, 1)
    expect(currentStep(sel)).toBe('done')
    expect(isComplete(sel)).toBe(true)
  })

  it('never mutates the input selection', () => {
    const start = EMPTY_SELECTION
    selectFaculty(start, 'biological-physical-sciences')
    expect(start).toEqual({ facultyId: null, programmeId: null, level: null, semester: null })
  })

  it('clears the chosen programme when the faculty changes', () => {
    let sel = selectProgramme(selectFaculty(EMPTY_SELECTION, 'biological-physical-sciences'), 'chemistry')
    expect(sel.programmeId).toBe('chemistry')

    sel = selectFaculty(sel, 'engineering-environmental')
    expect(sel.facultyId).toBe('engineering-environmental')
    expect(sel.programmeId).toBeNull()
    expect(currentStep(sel)).toBe('programme')
  })

  it('keeps level and semester when faculty/programme change (independent dimensions)', () => {
    let sel = selectSemester(selectLevel(selectFaculty(EMPTY_SELECTION, 'biological-physical-sciences'), 300), 2)
    sel = selectProgramme(sel, 'chemistry')
    sel = selectFaculty(sel, 'engineering-environmental')
    expect(sel.level).toBe(300)
    expect(sel.semester).toBe(2)
  })

  it('rejects a programme that does not belong to the chosen faculty', () => {
    const sel = selectFaculty(EMPTY_SELECTION, 'biological-physical-sciences')
    // 'accountancy' is under Business Administration, not this college → ignored.
    const after = selectProgramme(sel, 'accountancy')
    expect(after.programmeId).toBeNull()
  })

  it('ignores unknown faculties, programmes, levels and semesters', () => {
    expect(selectFaculty(EMPTY_SELECTION, 'ghost').facultyId).toBeNull()
    const sci = selectFaculty(EMPTY_SELECTION, 'biological-physical-sciences')
    expect(selectProgramme(sci, 'ghost').programmeId).toBeNull()
    // @ts-expect-error — 150 is not a valid level; setter must reject it.
    expect(selectLevel(sci, 150).level).toBeNull()
    // @ts-expect-error — 3 is not a valid semester; setter must reject it.
    expect(selectSemester(sci, 3).semester).toBeNull()
  })

  it('is not complete until all four dimensions are set', () => {
    const partial = selectProgramme(selectFaculty(EMPTY_SELECTION, 'biological-physical-sciences'), 'biochemistry')
    expect(isComplete(partial)).toBe(false)
    expect(isComplete(selectLevel(partial, 100))).toBe(false)
  })
})

describe('labels & summary', () => {
  it('formats levels and semesters for display', () => {
    expect(levelLabel(100)).toBe('100 Level')
    expect(semesterLabel(1)).toBe('First Semester')
    expect(semesterLabel(2)).toBe('Second Semester')
  })

  it('summarizes a complete selection with human names', () => {
    const sel = selectSemester(
      selectLevel(selectProgramme(selectFaculty(EMPTY_SELECTION, 'biological-physical-sciences'), 'biochemistry'), 200),
      1,
    )
    expect(isComplete(sel)).toBe(true)
    if (isComplete(sel)) {
      expect(summarize(sel)).toBe('Biochemistry (Biological & Physical Sciences) · 200 Level · First Semester')
    }
  })

  it('resolves a programme by id', () => {
    expect(programmeById('chemistry')?.name).toBe('Industrial Chemistry / Chemistry')
    expect(programmeById('nope')).toBeNull()
  })
})

describe('course catalog (scaffold)', () => {
  it('returns the courses for a programme/level/semester, including the seed course', () => {
    const courses = coursesFor('chemistry', 200, 1)
    expect(courses.length).toBeGreaterThan(0)
    expect(courses.map((c) => c.code)).toContain('CHM 213')
    // Every returned row matches the requested bucket.
    expect(courses.every((c) => c.programmeId === 'chemistry' && c.level === 200 && c.semester === 1)).toBe(true)
  })

  it('marks every scaffold row unverified and cites the CCMAS source', () => {
    const courses = coursesFor('biochemistry', 200, 1)
    expect(courses.map((c) => c.code)).toContain('BCH 201')
    expect(courses.every((c) => c.verified === false)).toBe(true)
    expect(courses.every((c) => c.sourceUrl === CCMAS_SOURCE_URL)).toBe(true)
  })

  it('returns an empty list for a bucket with no scaffold data', () => {
    expect(coursesFor('chemistry', 100, 1)).toEqual([])
    expect(coursesFor('mathematics', 300, 2)).toEqual([])
  })

  it('sums credit units', () => {
    const courses = coursesFor('chemistry', 200, 1)
    const expected = courses.reduce((s, c) => s + c.creditUnits, 0)
    expect(totalCreditUnits(courses)).toBe(expected)
    expect(totalCreditUnits([])).toBe(0)
  })
})
