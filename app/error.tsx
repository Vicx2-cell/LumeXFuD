'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

// Route-level error boundary. Without this, any client render error in a page
// segment unmounts the tree and shows a PURE BLANK screen (this is what made the
// admin section look "broken"). Now a crash shows a readable message + retry,
// and the error is logged for diagnosis.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app error boundary]', error)
    // Report to Sentry (scrubbed by beforeSend before leaving the browser).
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex items-center justify-center p-6" style={{ minHeight: '100dvh', background: '#0A0A0B', color: '#fff' }}>
      <div className="max-w-sm w-full text-center glass-thin p-6">
        <p className="text-3xl mb-3">⚠️</p>
        <h1 className="font-semibold text-lg">Something went wrong</h1>
        <p className="text-sm text-white/50 mt-2">This page hit an error and couldn’t finish loading.</p>
        {error?.message && (
          <p className="text-xs text-white/35 mt-3 break-words">{error.message}</p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={reset} className="lx-btn-amber flex-1 py-3">Try again</button>
          <button
            onClick={() => { window.location.href = '/' }}
            className="flex-1 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Home
          </button>
        </div>
      </div>
    </div>
  )
}
