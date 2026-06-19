import { Skeleton } from '@/components/ui/skeleton'

export default function CartLoading() {
  return (
    <div className="min-h-dvh pb-32" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 px-4 py-3 border-b border-white/8" style={{ background: '#0A0A0B' }}>
        <div className="max-w-lg mx-auto h-6 w-28 rounded-md animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}
