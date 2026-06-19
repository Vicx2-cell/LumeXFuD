import { VendorCardSkeleton } from '@/components/ui/skeleton'

// Instant home skeleton — appears the moment the tab is tapped.
export default function HomeLoading() {
  return (
    <div className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 px-4 py-3 border-b border-white/8" style={{ background: '#0A0A0B' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="h-6 w-40 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-9 w-20 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => <VendorCardSkeleton key={i} />)}
      </div>
    </div>
  )
}
