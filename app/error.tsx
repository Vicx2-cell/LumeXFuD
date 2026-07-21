'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { CircleAlert } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app error boundary]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="lx-page flex min-h-dvh items-center justify-center p-6 text-[var(--lx-text)]">
      <div className="glass-thin w-full max-w-sm p-6 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-300" aria-hidden="true">
          <CircleAlert size={23} />
        </span>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--lx-text-muted)]">This page hit an error and couldn&apos;t finish loading.</p>
        {error?.message && (
          <p className="mt-3 break-words text-xs text-[var(--lx-text-faint)]">{error.message}</p>
        )}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={reset} className="lx-btn-amber flex-1 py-3">Try again</button>
          <button
            type="button"
            onClick={() => { window.location.href = '/' }}
            className="lx-btn-secondary flex-1 py-3 text-sm"
          >
            Home
          </button>
        </div>
      </div>
    </main>
  )
}
