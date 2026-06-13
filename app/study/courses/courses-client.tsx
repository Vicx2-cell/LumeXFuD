'use client'

import Link from 'next/link'
import { useEffect, useReducer, useState, type ReactNode } from 'react'
import {
  coursesFor,
  totalCreditUnits,
  summarize,
  isComplete,
  programmeById,
  CCMAS_SOURCE_URL,
  type CatalogCourse,
  type CompleteSelection,
} from '@/lib/catalog'
import { loadSelection } from '@/lib/study-selection'

// The browse view is driven entirely by the client-side selection (localStorage),
// so it renders a loading state first, then resolves to one of: no selection yet,
// an error, an empty bucket, or the course list.
type State =
  | { status: 'loading' }
  | { status: 'nosel' }
  | { status: 'error' }
  | { status: 'empty'; sel: CompleteSelection }
  | { status: 'ready'; sel: CompleteSelection; courses: CatalogCourse[] }

export function CourseBrowser() {
  // dispatch (not useState) keeps the mount-time resolve out of
  // react-hooks/set-state-in-effect; the reducer just stores the resolved state.
  const [state, dispatch] = useReducer((_prev: State, next: State) => next, { status: 'loading' })

  useEffect(() => {
    try {
      const sel = loadSelection()
      if (!isComplete(sel)) {
        dispatch({ status: 'nosel' })
        return
      }
      const courses = coursesFor(sel.programmeId, sel.level, sel.semester)
      dispatch(courses.length ? { status: 'ready', sel, courses } : { status: 'empty', sel })
    } catch {
      dispatch({ status: 'error' })
    }
  }, [])

  if (state.status === 'loading') return <BrowseSkeleton />
  if (state.status === 'nosel') return <NoSelection />
  if (state.status === 'error') return <LoadError />
  if (state.status === 'empty') return <EmptyBucket sel={state.sel} />
  return <CourseList sel={state.sel} courses={state.courses} />
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="max-w-lg mx-auto px-4 pt-4 pb-28 space-y-3">{children}</div>
}

function BrowseSkeleton() {
  return (
    <Shell>
      <div className="lx-skeleton h-14 rounded-2xl" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="lx-skeleton h-16 rounded-2xl" />
      ))}
    </Shell>
  )
}

function NoSelection() {
  return (
    <Shell>
      <div className="rounded-2xl glass p-6 text-center lx-enter">
        <p className="font-semibold text-white/85">Pick your course details first</p>
        <p className="text-sm text-white/45 mt-1">Choose your college, department, level and semester.</p>
        <Link
          href="/study"
          className="mt-4 inline-flex items-center justify-center rounded-full px-4 py-3 text-sm font-semibold min-h-[44px]"
          style={{ background: '#F5A623', color: '#000' }}
        >
          Choose now
        </Link>
      </div>
    </Shell>
  )
}

function LoadError() {
  return (
    <Shell>
      <div className="rounded-2xl glass p-6 text-center lx-enter">
        <p className="font-semibold text-white/85">We couldn’t load your courses</p>
        <p className="text-sm text-white/45 mt-1">Something went wrong reading your selection.</p>
        <Link
          href="/study"
          className="mt-4 inline-flex items-center justify-center rounded-full px-4 py-3 text-sm font-semibold min-h-[44px]"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)' }}
        >
          Start over
        </Link>
      </div>
    </Shell>
  )
}

function SelectionHeader({ sel }: { sel: CompleteSelection }) {
  return (
    <div className="rounded-2xl glass p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-white/40">Your selection</p>
        <p className="mt-0.5 text-sm font-semibold text-white">{summarize(sel)}</p>
      </div>
      <Link
        href="/study"
        className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full min-h-[32px] inline-flex items-center"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
      >
        Change
      </Link>
    </div>
  )
}

function CcmasFootnote({ sel }: { sel: CompleteSelection }) {
  const lowConfidence = (programmeById(sel.programmeId)?.confidence ?? 1) < 0.5
  return (
    <div className="rounded-xl px-3 py-2.5 glass-thin space-y-1.5" style={{ borderRadius: 12 }}>
      <p className="text-xs text-white/55 leading-relaxed">
        Guided by the national <span className="text-white/80">CCMAS</span> curriculum — your
        university’s courses may vary. Confirm and edit against your actual ABSU list.
      </p>
      {lowConfidence && (
        <p className="text-xs leading-relaxed" style={{ color: '#F5A623' }}>
          This department’s course groupings are still being verified — treat these as a guide, not
          the final list.
        </p>
      )}
      <a
        href={CCMAS_SOURCE_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-block text-xs underline text-white/45"
      >
        Source: NUC CCMAS
      </a>
    </div>
  )
}

function CourseList({ sel, courses }: { sel: CompleteSelection; courses: CatalogCourse[] }) {
  const core = courses.filter((c) => c.kind === 'core')
  const electives = courses.filter((c) => c.kind === 'elective')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  return (
    <Shell>
      <SelectionHeader sel={sel} />

      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-white/45">
          {courses.length} course{courses.length === 1 ? '' : 's'} · {totalCreditUnits(courses)} units
        </p>
        <span
          className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
        >
          Unverified
        </span>
      </div>

      <CourseGroup label="Core" courses={core} selectedCode={selectedCode} onSelect={setSelectedCode} />
      <CourseGroup label="Electives" courses={electives} selectedCode={selectedCode} onSelect={setSelectedCode} />

      <CcmasFootnote sel={sel} />
    </Shell>
  )
}

function CourseGroup({
  label,
  courses,
  selectedCode,
  onSelect,
}: {
  label: string
  courses: CatalogCourse[]
  selectedCode: string | null
  onSelect: (code: string) => void
}) {
  if (courses.length === 0) return null
  return (
    <section className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-white/40 px-1 pt-1">{label}</p>
      <div className="space-y-2 lx-stagger">
        {courses.map((c) => (
          <CourseCard key={c.code} course={c} selected={selectedCode === c.code} onSelect={() => onSelect(c.code)} />
        ))}
      </div>
    </section>
  )
}

function CourseCard({
  course,
  selected,
  onSelect,
}: {
  course: CatalogCourse
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className="w-full text-left rounded-2xl p-4 min-h-[44px] transition-colors"
      style={
        selected
          ? { background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.45)' }
          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: selected ? '#F5A623' : '#fff' }}>{course.code}</p>
            {course.status === 'draft' && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(245,166,35,0.12)', color: 'rgba(245,166,35,0.85)' }}
                title="ABSU may set a different code, unit count or semester — confirm with your department."
              >
                confirm code
              </span>
            )}
            {course.status === 'absu_verified' && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(52,211,153,0.14)', color: 'rgba(52,211,153,0.95)' }}
                title="Confirmed by an ABSU course rep / students."
              >
                ✓ confirmed
              </span>
            )}
          </div>
          <p className="text-sm text-white/60 truncate">{course.title}</p>
        </div>
        <span className="shrink-0 text-xs text-white/45">{course.creditUnits} units</span>
      </div>
      {selected && (
        <p className="mt-2 text-xs text-white/50">Ask &amp; practice for this course opens with the study screen.</p>
      )}
    </button>
  )
}

function EmptyBucket({ sel }: { sel: CompleteSelection }) {
  return (
    <Shell>
      <SelectionHeader sel={sel} />
      <div className="rounded-2xl glass p-6 text-center">
        <p className="font-semibold text-white/85">No courses listed yet</p>
        <p className="text-sm text-white/45 mt-1 leading-relaxed">
          We don’t have a guided course list for this level and semester yet. The verified catalog
          is on the way.
        </p>
      </div>
      <CcmasFootnote sel={sel} />
    </Shell>
  )
}
