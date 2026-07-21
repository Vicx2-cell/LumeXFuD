// Root catch-all loading UI. Next shows this INSTANTLY on every navigation that
// doesn't have its own loading.tsx, while the (force-dynamic) destination renders
// on the server — so a tap opens immediately instead of freezing the old screen.
export default function Loading() {
  return (
    <main className="lx-page flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy="true">
      <div
        className="lx-spinner h-10 w-10"
        aria-hidden="true"
      />
      <p className="text-xs uppercase tracking-widest text-[var(--lx-text-faint)]" role="status">Loading…</p>
    </main>
  )
}
