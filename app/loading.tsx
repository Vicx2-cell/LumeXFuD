// Root catch-all loading UI. Next shows this INSTANTLY on every navigation that
// doesn't have its own loading.tsx, while the (force-dynamic) destination renders
// on the server — so a tap opens immediately instead of freezing the old screen.
export default function Loading() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4" style={{ background: '#0A0A0B' }}>
      <div
        className="w-10 h-10 rounded-full animate-spin"
        style={{ border: '3px solid rgba(245,166,35,0.25)', borderTopColor: '#F5A623' }}
      />
      <p className="text-xs tracking-widest uppercase text-white/30">Loading…</p>
    </div>
  )
}
