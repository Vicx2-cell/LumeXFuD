'use client'

import { useEffect, useState } from 'react'

// ─── Service worker registration ─────────────────────────────────────────────
// Registered only in production — a SW caching navigations/_next assets in dev
// fights Next's HMR. The SW itself (public/sw.js) never caches /api, Supabase,
// Paystack, or messaging providers.
function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker

    // Auto-update: when a NEW service worker takes control (a deploy shipped a
    // changed sw.js), reload once to the fresh app — no manual cache-clearing.
    // The SW calls skipWaiting()+clients.claim(), so a new one activates and
    // fires controllerchange. We skip the very first install (no prior
    // controller) so a fresh visit doesn't reload needlessly.
    const hadController = !!sw.controller
    let reloaded = false
    const onControllerChange = () => {
      if (reloaded || !hadController) return
      reloaded = true
      window.location.reload()
    }
    sw.addEventListener('controllerchange', onControllerChange)

    let reg: ServiceWorkerRegistration | null = null
    sw.register('/sw.js')
      .then((r) => { reg = r; return r.update() })
      .catch(() => { /* best-effort; the app works without the SW */ })

    // Re-check for a newer SW every time the app is brought to the foreground
    // (how a home-screen PWA is typically relaunched), so updates land promptly.
    const onVisible = () => { if (document.visibilityState === 'visible') reg?.update().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      sw.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}

// ─── Install prompt ──────────────────────────────────────────────────────────
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type NavigatorStandalone = Navigator & { standalone?: boolean }

const DISMISS_KEY = 'lumex-install-dismissed'
const VISIT_KEY = 'lumex-visits'

// Count visits so the install banner only appears from the SECOND visit on —
// prompting on the very first visit is too aggressive. Storage-blocked browsers
// fall back to treating each load as a fresh first visit (banner stays hidden).
function recordVisitAndCount(): number {
  try {
    const n = (parseInt(localStorage.getItem(VISIT_KEY) ?? '0', 10) || 0) + 1
    localStorage.setItem(VISIT_KEY, String(n))
    return n
  } catch {
    return 1
  }
}

// localStorage access throws (not just on write) when site data is blocked —
// Firefox strict mode, some in-app webviews. Treat any failure as "not dismissed".
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) !== null
  } catch {
    return false
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* storage blocked — banner just reappears next visit */
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as NavigatorStandalone).standalone === true
  )
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ identifies as a Mac — disambiguate by touch support.
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  )
}

function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Already installed, or the user dismissed the prompt before → stay quiet.
    if (isStandalone()) return
    if (wasDismissed()) return

    // Only prompt from the second visit onward.
    const secondVisit = recordVisitAndCount() >= 2

    // Android / desktop Chromium: capture the native prompt and show our own UI.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      if (secondVisit) setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // Once installed, never nag again.
    const onInstalled = () => {
      setVisible(false)
      rememberDismissed()
    }
    window.addEventListener('appinstalled', onInstalled)

    // iOS Safari fires no beforeinstallprompt — offer the manual A2HS guide.
    if (isIOS() && secondVisit) setVisible(true)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    setShowIOSGuide(false)
    rememberDismissed()
  }

  async function install() {
    if (deferred) {
      await deferred.prompt()
      await deferred.userChoice
      setDeferred(null)
      dismiss()
      return
    }
    // No native prompt available → must be iOS, show the manual steps.
    setShowIOSGuide(true)
  }

  if (!visible) return null

  return (
    <>
      {/* Bottom banner — sits above the bottom nav */}
      <div
        className="fixed inset-x-0 z-50 px-4"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
      >
        <div
          className="max-w-lg mx-auto flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{
            background: 'rgba(20,20,22,0.96)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(245,166,35,0.25)',
          }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: 'rgba(245,166,35,0.15)' }}>
            📲
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Install LumeX Fud</p>
            <p className="text-xs text-white/40">Add to your home screen for faster ordering</p>
          </div>
          <button
            onClick={install}
            className="rounded-xl px-3 py-2 text-xs font-semibold shrink-0"
            style={{ background: '#F5A623', color: '#000' }}
          >
            Install
          </button>
          <button
            onClick={dismiss}
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white/40"
            aria-label="Dismiss install prompt"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* iOS Add-to-Home guide */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center px-4 pb-6"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={dismiss}
        >
          <div
            className="max-w-lg w-full rounded-3xl p-6"
            style={{ background: '#141416', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Add LumeX to Home Screen</h2>
              <button
                onClick={dismiss}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/40"
                aria-label="Close"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                ✕
              </button>
            </div>
            <ol className="space-y-3">
              {[
                <>Tap the <span className="font-semibold" style={{ color: '#F5A623' }}>Share</span> icon (the square with an arrow) in Safari&apos;s toolbar.</>,
                <>Scroll down and tap <span className="font-semibold" style={{ color: '#F5A623' }}>Add to Home Screen</span>.</>,
                <>Tap <span className="font-semibold" style={{ color: '#F5A623' }}>Add</span> in the top corner. LumeX will appear on your home screen.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/80">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Offline banner ──────────────────────────────────────────────────────────
// Subtle, non-blocking amber pill at the top while the device is offline. Never
// a modal — the user can keep browsing cached pages. Driven by navigator.onLine
// plus the online/offline events.
function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      className="fixed inset-x-0 top-0 z-[70] px-4 pointer-events-none"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      role="status"
      aria-live="polite"
    >
      <div
        className="max-w-lg mx-auto flex items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-medium"
        style={{
          background: 'rgba(245,166,35,0.15)',
          border: '1px solid rgba(245,166,35,0.3)',
          color: '#F5A623',
          backdropFilter: 'blur(12px)',
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#F5A623' }} />
        You&apos;re offline — showing saved data
      </div>
    </div>
  )
}

// Platform-tiered glass: tag the document `lx-rich` ONLY on non-iOS, fine-pointer
// devices (laptops/desktops) so they get the heavy backdrop-filter blur. Phones
// (iOS + Android, touch) keep the safe baseline radii — iOS never gets `lx-rich`,
// so the heavy blur can never crash Safari's renderer ("page couldn't load").
function PlatformClass() {
  useEffect(() => {
    const ua = navigator.userAgent
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (!isIOS && finePointer) document.documentElement.classList.add('lx-rich')
  }, [])
  return null
}

export function PWA() {
  return (
    <>
      <ServiceWorkerRegister />
      <PlatformClass />
      <InstallPrompt />
      <OfflineBanner />
    </>
  )
}
