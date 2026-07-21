import { Skeleton } from '@/components/ui/skeleton'

// Instant wallet skeleton — appears the moment the page is opened.
export default function WalletLoading() {
  return (
    <main className="lx-page min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading wallet</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="h-9 w-9 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-6 w-24 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-32 w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </main>
  )
}
