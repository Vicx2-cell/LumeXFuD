import { Skeleton } from '@/components/ui/skeleton'

// Instant order-tracking skeleton — appears the moment the order is opened.
export default function OrderLoading() {
  return (
    <main className="lx-page min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading order details</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="h-9 w-9 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-6 w-40 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
        <Skeleton className="h-px w-full" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </main>
  )
}
