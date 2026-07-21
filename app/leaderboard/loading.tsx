import { Skeleton } from '@/components/ui/skeleton'

// Instant leaderboard skeleton — appears the moment the tab is tapped.
export default function LeaderboardLoading() {
  return (
    <main className="lx-page min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading leaderboard</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="mx-auto max-w-lg"><Skeleton className="h-6 w-32 rounded-md" /></div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 flex-1 rounded-full" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </main>
  )
}
