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

    const sciences = programmesForFaculty('sciences')
    expect(sciences.length).toBeGreaterThan(0)
    expect(sciences.every((p) => p.facultyId === 'sciences')).toBe(true)
    // Biochemistry/Chemistry (the seed-course programmes) live under Sciences.
    expect(sciences.map((p) => p.id)).toContain('biochemistry')
    expect(sciences.map((p) => p.id)).toContain('chemistry')
  })

  it('returns no programmes for an unknown or unset faculty', () => {
    expect(programmesForFaculty('does-not-exist')).toEqual([])
    expect(programmesForFaculty(null)).toEqual([])
  })
})

describe('selection state machine', () => {
  it('walks faculty → programme → level → semester → done', () => {
    let sel: CatalogSelection = EMPTY_SELECTION
    expect(currentStep(sel)).toBe('faculty')

    sel = selectFaculty(sel, 'sciences')
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
    selectFaculty(start, 'sciences')
    expect(start).toEqual({ facultyId: null, programmeId: null, level: null, semester: null })
  })

  it('clears the chosen programme when the faculty changes', () => {
    let sel = selectProgramme(selectFaculty(EMPTY_SELECTION, 'sciences'), 'chemistry')
    expect(sel.programmeId).toBe('chemistry')

    sel = selectFaculty(sel, 'engineering')
    expect(sel.facultyId).toBe('engineering')
    expect(sel.programmeId).toBeNull()
    expect(currentStep(sel)).toBe('programme')
  })

  it('keeps level and semester when faculty/programme change (independent dimensions)', () => {
    let sel = selectSemester(selectLevel(selectFaculty(EMPTY_SELECTION, 'sciences'), 300), 2)
    sel = selectProgramme(sel, 'chemistry')
    sel = selectFaculty(sel, 'engineering')
    expect(sel.level).toBe(300)
    expect(sel.semester).toBe(2)
  })

  it('rejects a programme that does not belong to the chosen faculty', () => {
    const sel = selectFaculty(EMPTY_SELECTION, 'sciences')
    // 'accounting' is under Management Sciences, not Sciences → ignored.
    const after = selectProgramme(sel, 'accounting')
    expect(after.programmeId).toBeNull()
  })

  it('ignores unknown faculties, programmes, levels and semesters', () => {
    expect(selectFaculty(EMPTY_SELECTION, 'ghost').facultyId).toBeNull()
    const sci = selectFaculty(EMPTY_SELECTION, 'sciences')
    expect(selectProgramme(sci, 'ghost').programmeId).toBeNull()
    // @ts-expect-error — 150 is not a valid level; setter must reject it.
    expect(selectLevel(sci, 150).level).toBeNull()
    // @ts-expect-error — 3 is not a valid semester; setter must reject it.
    expect(selectSemester(sci, 3).semester).toBeNull()
  })

  it('is not complete until all four dimensions are set', () => {
    const partial = selectProgramme(selectFaculty(EMPTY_SELECTION, 'sciences'), 'biochemistry')
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
      selectLevel(selectProgramme(selectFaculty(EMPTY_SELECTION, 'sciences'), 'biochemistry'), 200),
      1,
    )
    expect(isComplete(sel)).toBe(true)
    if (isComplete(sel)) {
      expect(summarize(sel)).toBe('Biochemistry (Sciences) · 200 Level · First Semester')
    }
  })

  it('resolves a programme by id', () => {
    expect(programmeById('chemistry')?.name).toBe('Chemistry')
    expect(programmeById('nope')).toBeNull()
  })
})
