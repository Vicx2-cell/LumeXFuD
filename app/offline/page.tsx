import { WifiOff } from 'lucide-react'

export default function OfflinePage() {
  return (
    <main className="lx-page flex min-h-dvh flex-col items-center justify-center px-6 text-center text-[var(--lx-text)] [padding-bottom:calc(env(safe-area-inset-bottom)+1.5rem)] [padding-top:calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--lx-border)] bg-[var(--lx-surface)] text-[var(--color-amber)]" aria-hidden="true"><WifiOff size={25} /></div>
      <h1 className="mb-3 text-2xl font-bold">
        You&apos;re offline
      </h1>
      <p className="max-w-xs text-base leading-relaxed text-[var(--lx-text-muted)]">
        Check your internet connection and try again.
      </p>
    </main>
  )
}
