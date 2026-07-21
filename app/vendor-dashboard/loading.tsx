import { Skeleton } from '@/components/ui/skeleton'

// Instant vendor dashboard skeleton — appears the moment it is opened.
export default function VendorDashboardLoading() {
  return (
    <main className="lx-page lx-console min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading vendor workspace</span>
      <div className="sticky top-0 z-40 px-4 py-3 border-b border-white/8" style={{ background: '#0A0A0B' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="h-6 w-40 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-9 w-24 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </main>
  )
}
