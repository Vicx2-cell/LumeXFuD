import { Skeleton } from '@/components/ui/skeleton'

// Instant vendor-menu skeleton.
export default function VendorLoading() {
  return (
    <div className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="h-40 w-full animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="h-16 w-16 rounded-xl animate-pulse shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
