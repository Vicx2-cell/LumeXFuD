import Link from 'next/link'
import { MapPinOff } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="lx-page flex min-h-dvh items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--lx-border)] bg-[var(--lx-surface)] text-[var(--color-amber)]" aria-hidden="true">
          <MapPinOff size={25} />
        </span>
        <p className="lx-mono mb-2">404</p>
        <h1 className="text-2xl font-bold text-[var(--lx-text)]">Page not found</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[var(--lx-text-muted)]">
          This link may have moved, expired, or never existed.
        </p>
        <Link href="/" className="lx-btn-amber mt-6 inline-flex min-h-12 items-center justify-center px-5 py-3 text-sm">
          Back to LumeX
        </Link>
      </div>
    </main>
  )
}
