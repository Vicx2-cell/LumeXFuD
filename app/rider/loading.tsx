import { Skeleton } from '@/components/ui/skeleton'

// Instant rider dashboard skeleton — appears the moment it is opened.
export default function RiderLoading() {
  return (
    <div className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 px-4 py-3 border-b border-white/8" style={{ background: '#0A0A0B' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="h-6 w-32 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-9 w-28 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
