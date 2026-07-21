import { Skeleton } from '@/components/ui/skeleton'

// Instant group-order skeleton — appears the moment the link is opened.
export default function GroupLoading() {
  return (
    <main className="lx-page min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading group order</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="max-w-lg mx-auto h-6 w-36 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </main>
  )
}
