import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { getFeature } from '@/lib/features'
import { StudySelector } from './study-client'

// The selector data is local (CCMAS-guided scaffold in lib/catalog) — no per-user
// data to fetch — so this stays a static shell. Gated by the super-admin `study`
// flag (off by default while the section is being built).
export const metadata = {
  title: 'Study — LumeX',
  description: 'Pick your faculty, programme, level and semester to see what to study.',
}

export default async function StudyPage() {
  if (!(await getFeature('study'))) {
    return (
      <main className="lx-page pb-24 flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        <div className="relative z-10 lx-enter">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          </div>
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
          <BackButton />
          <div>
            <h1 className="font-semibold">Study</h1>
            <p className="text-xs text-white/40 mt-0.5">What are you offering this semester?</p>
          </div>
        </div>
      </div>

      <StudySelector />

      <BottomNav />
    </main>
  )
}
