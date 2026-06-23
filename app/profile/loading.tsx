import { Skeleton } from '@/components/ui/skeleton'

// Instant profile skeleton — appears the moment the tab is tapped.
export default function ProfileLoading() {
  return (
    <div className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 px-4 py-3 border-b border-white/8" style={{ background: '#0A0A0B' }}>
        <div className="max-w-lg mx-auto h-6 w-28 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
