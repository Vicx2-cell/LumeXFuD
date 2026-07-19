export function Skeleton({ className = '' }: { className?: string }) {
  // lx-skeleton = the branded shimmer sweep (theme-aware) instead of a flat pulse.
  return (
    <div
      className={`lx-skeleton rounded-lg ${className}`}
      aria-hidden="true"
    />
  )
}

export function VendorCardSkeleton() {
  return (
    <div className="grid min-h-[124px] grid-cols-[106px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/8 bg-white/5 sm:grid-cols-[118px_minmax(0,1fr)]">
      <Skeleton className="h-full min-h-[124px] w-full rounded-none" />
      <div className="flex flex-col justify-center gap-3 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

export function OrderCardSkeleton() {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/8 p-4 space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-1/4" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}
