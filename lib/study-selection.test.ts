import { describe, it, expect } from 'vitest'
import { parseStoredSelection } from './study-selection'
import { EMPTY_SELECTION } from './catalog'

describe('parseStoredSelection', () => {
  it('returns the empty selection for null or blank input', () => {
    expect(parseStoredSelection(null)).toEqual(EMPTY_SELECTION)
    expect(parseStoredSelection('')).toEqual(EMPTY_SELECTION)
  })

  it('returns the empty selection for non-JSON / garbage', () => {
    expect(parseStoredSelection('not json')).toEqual(EMPTY_SELECTION)
    expect(parseStoredSelection('{broken')).toEqual(EMPTY_SELECTION)
  })

  it('restores a full valid selection', () => {
    const raw = JSON.stringify({ facultyId: 'biological-physical-sciences', programmeId: 'biochemistry', level: 200, semester: 1 })
    expect(parseStoredSelection(raw)).toEqual({
      facultyId: 'biological-physical-sciences',
      programmeId: 'biochemistry',
      level: 200,
      semester: 1,
    })
  })

  it('keeps a partial selection (faculty only)', () => {
    const raw = JSON.stringify({ facultyId: 'biological-physical-sciences' })
    expect(parseStoredSelection(raw)).toEqual({ ...EMPTY_SELECTION, facultyId: 'biological-physical-sciences' })
  })

  it('drops an unknown faculty and its programme but keeps independent level/semester', () => {
    const raw = JSON.stringify({ facultyId: 'ghost', programmeId: 'biochemistry', level: 200, semester: 1 })
    // Unknown faculty → ignored; the programme can't attach without it; but level
    // and semester are independent dimensions and legitimately survive.
    expect(parseStoredSelection(raw)).toEqual({ facultyId: null, programmeId: null, level: 200, semester: 1 })
  })

  it('drops a programme that does not belong to the stored faculty', () => {
    const raw = JSON.stringify({ facultyId: 'biological-physical-sciences', programmeId: 'accountancy' })
    expect(parseStoredSelection(raw)).toEqual({ ...EMPTY_SELECTION, facultyId: 'biological-physical-sciences' })
  })

  it('drops invalid level and semester values', () => {
    const raw = JSON.stringify({ facultyId: 'biological-physical-sciences', programmeId: 'chemistry', level: 150, semester: 9 })
    expect(parseStoredSelection(raw)).toEqual({
      facultyId: 'biological-physical-sciences',
      programmeId: 'chemistry',
      level: null,
      semester: null,
    })
  })

  it('ignores wrong-typed fields without throwing', () => {
    const raw = JSON.stringify({ facultyId: 123, programmeId: ['x'], level: '200', semester: true })
    expect(parseStoredSelection(raw)).toEqual(EMPTY_SELECTION)
  })
})
