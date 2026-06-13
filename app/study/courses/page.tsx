import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { getFeature } from '@/lib/features'
import { CourseBrowser } from './courses-client'

export const metadata = {
  title: 'Your courses — LumeX',
  description: 'The courses you should be offering this semester, guided by the CCMAS curriculum.',
}

export default async function StudyCoursesPage() {
  if (!(await getFeature('study'))) {
    return (
      <main className="lx-page pb-24 flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        <div className="relative z-10 lx-enter">
          <p className="font-semibold text-white/80">Study is taking a break</p>
          <p className="text-sm text-white/45 mt-1">Check back soon.</p>
        </div>
        <BottomNav />
      </main>
    )
  }

  return (
    <main className="lx-page pb-24 overflow-hidden">
      <div
        className="sticky top-0 z-40 glass-thin px-4 py-3"
        style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}
      >
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <BackButton fallback="/study" />
          <div>
            <h1 className="font-semibold">Your courses</h1>
            <p className="text-xs text-white/40 mt-0.5">What to study this semester</p>
          </div>
        </div>
      </div>

      <CourseBrowser />

      <BottomNav />
    </main>
  )
}
