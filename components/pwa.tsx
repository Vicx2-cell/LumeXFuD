'use client'

import { useEffect, useState } from 'react'

// ─── Service worker registration ─────────────────────────────────────────────
// Registered only in production — a SW caching navigations/_next assets in dev
// fights Next's HMR. The SW itself (public/sw.js) never caches /api, Supabase,
// Paystack, or Termii.
function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration is best-effort; the app works without it */
    })
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

    // Android / desktop Chromium: capture the native prompt and show our own UI.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // Once installed, never nag again.
    const onInstalled = () => {
      setVisible(false)
      rememberDismissed()
    }
    window.addEventListener('appinstalled', onInstalled)

    // iOS Safari fires no beforeinstallprompt — offer the manual A2HS guide.
    if (isIOS()) setVisible(true)

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

export function PWA() {
  return (
    <>
      <ServiceWorkerRegister />
      <InstallPrompt />
    </>
  )
}
