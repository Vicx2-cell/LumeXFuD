import {
  EMPTY_SELECTION,
  selectFaculty,
  selectProgramme,
  selectLevel,
  selectSemester,
  type CatalogSelection,
  type CourseLevel,
  type Semester,
} from './catalog'

// Shared persistence for the in-progress study selection, so the selector
// (/study) and the course browse view (/study/courses) agree on one source.
// Only the four ids/numbers are stored — nothing sensitive, no prices.
export const STORAGE_KEY = 'lx-study-selection'

/**
 * Turn a stored JSON string into a sanitized selection. Pure (no `window`) so it
 * can be unit-tested: every field is re-applied through the validated catalog
 * setters, so stale or hand-tampered data can never produce an invalid selection.
 */
export function parseStoredSelection(raw: string | null): CatalogSelection {
  if (!raw) return EMPTY_SELECTION
  try {
    const parsed = JSON.parse(raw) as Partial<CatalogSelection>
    let sel: CatalogSelection = EMPTY_SELECTION
    if (typeof parsed.facultyId === 'string') sel = selectFaculty(sel, parsed.facultyId)
    if (typeof parsed.programmeId === 'string') sel = selectProgramme(sel, parsed.programmeId)
    if (typeof parsed.level === 'number') sel = selectLevel(sel, parsed.level as CourseLevel)
    if (typeof parsed.semester === 'number') sel = selectSemester(sel, parsed.semester as Semester)
    return sel
  } catch {
    return EMPTY_SELECTION
  }
}

export function loadSelection(): CatalogSelection {
  if (typeof window === 'undefined') return EMPTY_SELECTION
  try {
    return parseStoredSelection(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY_SELECTION
  }
}

export function saveSelection(sel: CatalogSelection): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sel))
  } catch {
    /* storage full / disabled — selection just won't persist */
  }
}
