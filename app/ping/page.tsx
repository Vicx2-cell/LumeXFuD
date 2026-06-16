import type { Metadata } from 'next'

// Lightweight health/diagnostic page. Not indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function Ping() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        background: '#0A0A0B',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 56 }}>🍲</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>LumeX Fud</h1>
      <p style={{ opacity: 0.6, fontSize: 14 }}>Service is up.</p>
      <a href="/" style={{ marginTop: 12, color: '#F5A623', fontWeight: 600, fontSize: 14 }}>Go to LumeX Fud →</a>
    </main>
  )
}
