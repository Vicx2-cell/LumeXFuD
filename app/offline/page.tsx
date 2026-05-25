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
        padding: '1.5rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        You&apos;re offline
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9375rem', maxWidth: '16rem' }}>
        Check your internet connection and try again.
      </p>
    </main>
  )
}
