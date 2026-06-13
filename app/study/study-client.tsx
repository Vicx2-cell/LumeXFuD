'use client'

import Link from 'next/link'
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import {
  EMPTY_SELECTION,
  COURSE_LEVELS,
  SEMESTERS,
  listFaculties,
  programmesForFaculty,
  facultyById,
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
  type CourseLevel,
  type Semester,
  type Step,
} from '@/lib/catalog'
import { loadSelection, saveSelection } from '@/lib/study-selection'

const STEP_TITLES: Record<Exclude<Step, 'done'>, string> = {
  faculty: 'Your college',
  programme: 'Your department',
  level: 'Your level',
  semester: 'Which semester',
}

type Action =
  | { type: 'hydrate'; sel: CatalogSelection }
  | { type: 'faculty'; id: string }
  | { type: 'programme'; id: string }
  | { type: 'level'; level: CourseLevel }
  | { type: 'semester'; semester: Semester }

// All edits funnel through the pure setters in lib/catalog, which enforce the
// faculty→programme dependency. dispatch (vs a useState setter) is also what lets
// us hydrate inside an effect without tripping react-hooks/set-state-in-effect.
function reducer(sel: CatalogSelection, action: Action): CatalogSelection {
  switch (action.type) {
    case 'hydrate':
      return action.sel
    case 'faculty':
      return selectFaculty(sel, action.id)
    case 'programme':
      return selectProgramme(sel, action.id)
    case 'level':
      return selectLevel(sel, action.level)
    case 'semester':
      return selectSemester(sel, action.semester)
  }
}

export function StudySelector() {
  const [sel, dispatch] = useReducer(reducer, EMPTY_SELECTION)
  // Which row the student is actively editing (overrides the natural next step).
  const [editing, setEditing] = useState<Step | null>(null)
  const firstWrite = useRef(true)

  // Restore any saved selection once, on mount (avoids SSR hydration mismatch).
  useEffect(() => {
    dispatch({ type: 'hydrate', sel: loadSelection() })
  }, [])

  // Persist on change. Skip the first run so the empty pre-hydration default
  // never clobbers a saved selection.
  useEffect(() => {
    if (firstWrite.current) {
      firstWrite.current = false
      return
    }
    saveSelection(sel)
  }, [sel])

  const step = editing ?? currentStep(sel)

  // Apply a choice, then close the edit panel so the flow advances.
  function pick(action: Action) {
    dispatch(action)
    setEditing(null)
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-28 space-y-3 lx-stagger">
      <CcmasNote />

      <SelectedRow
        label={STEP_TITLES.faculty}
        value={facultyById(sel.facultyId)?.name ?? null}
        active={step === 'faculty'}
        onEdit={() => setEditing('faculty')}
      >
        <OptionGrid>
          {listFaculties().map((f) => (
            <Option
              key={f.id}
              label={f.name}
              selected={sel.facultyId === f.id}
              onClick={() => pick({ type: 'faculty', id: f.id })}
            />
          ))}
        </OptionGrid>
      </SelectedRow>

      <SelectedRow
        label={STEP_TITLES.programme}
        value={programmeById(sel.programmeId)?.name ?? null}
        active={step === 'programme'}
        locked={!sel.facultyId}
        lockedHint="Pick your college first"
        onEdit={() => setEditing('programme')}
      >
        <OptionGrid>
          {programmesForFaculty(sel.facultyId).map((p) => (
            <Option
              key={p.id}
              label={p.name}
              selected={sel.programmeId === p.id}
              onClick={() => pick({ type: 'programme', id: p.id })}
            />
          ))}
        </OptionGrid>
      </SelectedRow>

      <SelectedRow
        label={STEP_TITLES.level}
        value={sel.level != null ? levelLabel(sel.level) : null}
        active={step === 'level'}
        onEdit={() => setEditing('level')}
      >
        <OptionGrid cols={3}>
          {COURSE_LEVELS.map((l) => (
            <Option
              key={l}
              label={levelLabel(l)}
              selected={sel.level === l}
              onClick={() => pick({ type: 'level', level: l })}
            />
          ))}
        </OptionGrid>
      </SelectedRow>

      <SelectedRow
        label={STEP_TITLES.semester}
        value={sel.semester != null ? semesterLabel(sel.semester) : null}
        active={step === 'semester'}
        onEdit={() => setEditing('semester')}
      >
        <OptionGrid cols={2}>
          {SEMESTERS.map((s) => (
            <Option
              key={s}
              label={semesterLabel(s)}
              selected={sel.semester === s}
              onClick={() => pick({ type: 'semester', semester: s })}
            />
          ))}
        </OptionGrid>
      </SelectedRow>

      {isComplete(sel) && (
        <div
          className="rounded-2xl p-4 lx-pop"
          style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.3)' }}
        >
          <p className="text-xs uppercase tracking-wide text-white/45">You’re all set</p>
          <p className="mt-1 text-sm font-semibold" style={{ color: '#F5A623' }}>{summarize(sel)}</p>
          <p className="mt-2 text-xs text-white/45 leading-relaxed">
            Here are the courses you should be offering this semester. Your university’s list
            may differ — you’ll be able to confirm and edit it.
          </p>
          <Link
            href="/study/courses"
            className="lx-btn-amber mt-3 inline-flex items-center justify-center gap-1.5 w-full rounded-full px-4 py-3 text-sm font-semibold min-h-[44px]"
            style={{ background: '#F5A623', color: '#000' }}
          >
            See my courses →
          </Link>
        </div>
      )}
    </div>
  )
}

function CcmasNote() {
  return (
    <div className="rounded-xl px-3 py-2.5 glass-thin" style={{ borderRadius: 12 }}>
      <p className="text-xs text-white/55 leading-relaxed">
        Guided by the national <span className="text-white/80">CCMAS</span> curriculum — your
        university’s courses may vary; you’ll confirm your actual courses next.
      </p>
    </div>
  )
}

function SelectedRow({
  label,
  value,
  active,
  locked = false,
  lockedHint,
  onEdit,
  children,
}: {
  label: string
  value: string | null
  active: boolean
  locked?: boolean
  lockedHint?: string
  onEdit: () => void
  children: ReactNode
}) {
  const open = active && !locked

  return (
    <section
      className="rounded-2xl glass"
      style={{ padding: 16, opacity: locked ? 0.5 : 1 }}
      aria-current={open ? 'step' : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
          {value && !open ? (
            <p className="mt-0.5 text-sm font-semibold text-white truncate">{value}</p>
          ) : locked ? (
            <p className="mt-0.5 text-sm text-white/40">{lockedHint}</p>
          ) : null}
        </div>
        {value && !open && (
          <button
            onClick={onEdit}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full min-h-[32px]"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
          >
            Change
          </button>
        )}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  )
}

function OptionGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{children}</div>
  )
}

function Option({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className="rounded-xl px-3 py-3 text-sm font-medium text-left min-h-[44px] transition-colors"
      style={
        selected
          ? { background: 'rgba(245,166,35,0.16)', border: '1px solid rgba(245,166,35,0.5)', color: '#F5A623' }
          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)' }
      }
    >
      {label}
    </button>
  )
}
