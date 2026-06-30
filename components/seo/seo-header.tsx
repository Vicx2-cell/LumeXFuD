import Link from 'next/link'

// Lightweight, fully-static public header for the /uturu content pages. No client
// JS, no GSAP, no auth read — keeps these pages cheap to render and fast on 2G.
// The wordmark goes home; the CTA opens the app.
export function SeoHeader() {
  return (
    <header className="lx-topbar sticky top-0 z-30 border-b border-white/8 backdrop-blur-md" style={{ background: 'rgba(10,10,11,0.72)' }}>
      <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" className="lx-display font-bold text-base lx-amber inline-flex items-center min-h-[44px]">
          LumeX&nbsp;<span className="text-white">Fud</span>
        </Link>
        <Link
          href="/home"
          className="lx-btn-amber inline-flex items-center justify-center px-4 text-sm font-medium"
          style={{ minHeight: 40, borderRadius: 12 }}
        >
          Open LumeX
        </Link>
      </div>
    </header>
  )
}
