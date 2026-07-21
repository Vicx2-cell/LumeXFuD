import { Skeleton } from './skeleton'

export function DashboardLoading({ label = 'dashboard' }: { label?: string }) {
  return (
    <main className="lx-page lx-console min-h-dvh pb-24" aria-busy="true">
      <span className="sr-only" role="status">Loading {label}</span>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-7 space-y-3 border-b border-[var(--lx-border)] pb-5">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-9 w-56 max-w-[70vw] rounded-lg" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </header>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="lx-surface mt-5 space-y-4 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 border-t border-[var(--lx-border)] pt-4 first:border-0 first:pt-0">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
