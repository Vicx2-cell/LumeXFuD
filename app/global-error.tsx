'use client'

// Catches errors thrown in the ROOT layout (where app/error.tsx can't reach).
// Must render its own <html>/<body>. Inline styles only — no app CSS is
// guaranteed to be present at this level.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ background: '#0A0A0B', color: '#fff', fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 360, textAlign: 'center' }}>
            <p style={{ fontSize: 30, margin: 0 }}>⚠️</p>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 8 }}>The app hit an error and couldn’t load.</p>
            {error?.message && (
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 12, wordBreak: 'break-word' }}>{error.message}</p>
            )}
            <button
              onClick={reset}
              style={{ marginTop: 20, padding: '12px 22px', background: '#F5A623', color: '#000', border: 0, borderRadius: 12, fontWeight: 600 }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
