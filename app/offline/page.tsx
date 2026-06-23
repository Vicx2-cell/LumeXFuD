export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0A0A0B',
        color: '#ffffff',
        padding:
          'calc(env(safe-area-inset-top, 0px) + 1.5rem) calc(env(safe-area-inset-right, 0px) + 1.5rem) calc(env(safe-area-inset-bottom, 0px) + 1.5rem) calc(env(safe-area-inset-left, 0px) + 1.5rem)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        You&apos;re offline
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '1rem', maxWidth: '18rem', lineHeight: 1.5 }}>
        Check your internet connection and try again.
      </p>
    </main>
  )
}
