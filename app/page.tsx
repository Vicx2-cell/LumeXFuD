export default function HomePage() {
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
      <div style={{ marginBottom: '1.5rem' }}>
        <span
          style={{
            display: 'inline-block',
            background: '#F5A623',
            color: '#000',
            fontWeight: 700,
            fontSize: '1.125rem',
            letterSpacing: '-0.02em',
            padding: '0.375rem 0.875rem',
            borderRadius: '0.5rem',
          }}
        >
          LumeX Fud
        </span>
      </div>
      <h1
        style={{
          fontSize: '1.75rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.2,
          marginBottom: '0.75rem',
        }}
      >
        Campus life, simplified.
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9375rem', maxWidth: '18rem' }}>
        Food delivery for ABSU students. Coming soon.
      </p>
    </main>
  )
}
