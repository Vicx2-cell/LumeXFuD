import { OrderCardSkeleton } from '@/components/ui/skeleton'

export default function OrdersLoading() {
  return (
    <main className="lx-page min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading orders</span>
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="mx-auto max-w-lg"><div className="lx-skeleton h-6 w-32 rounded-md" /></div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} />)}
      </div>
    </main>
  )
}
