import { OrderCardSkeleton } from '@/components/ui/skeleton'

export default function OrdersLoading() {
  return (
    <div className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 px-4 py-3 border-b border-white/8" style={{ background: '#0A0A0B' }}>
        <div className="max-w-lg mx-auto h-6 w-32 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} />)}
      </div>
    </div>
  )
}
