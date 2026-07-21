import { VendorCardSkeleton } from '@/components/ui/skeleton'

// Instant home skeleton — appears the moment the tab is tapped.
export default function HomeLoading() {
  return (
    <main className="lx-page min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading restaurants</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="lx-skeleton h-6 w-40 rounded-md" />
          <div className="lx-skeleton h-9 w-20 rounded-full" />
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => <VendorCardSkeleton key={i} />)}
      </div>
    </main>
  )
}
