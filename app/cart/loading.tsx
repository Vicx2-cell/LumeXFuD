import { Skeleton } from '@/components/ui/skeleton'

export default function CartLoading() {
  return (
    <main className="lx-page min-h-dvh pb-32" aria-busy="true">
      <span className="sr-only" role="status">Loading your cart</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="mx-auto max-w-lg"><Skeleton className="h-6 w-28 rounded-md" /></div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </main>
  )
}
