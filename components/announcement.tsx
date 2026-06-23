'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Ann {
  id: string
  title: string | null
  message: string
  level: 'info' | 'warning' | 'success'
}

// A dismissed banner stays hidden for the current LOGIN only. On a new login the
// session marker (`sid`) changes and we wipe the dismissed set, so every active
// announcement shows AGAIN on each login. It only goes away permanently when the
// super-admin clears it or it expires.
const DISMISS_KEY = 'lumex-dismissed-announcements'
const SID_KEY = 'lumex-ann-sid'
// Urgent (red) messages we've already sounded for THIS login (reset on new login).
const ALERTED_KEY = 'lumex-ann-alerted'

function getAlerted(): string[] {
  try { return JSON.parse(localStorage.getItem(ALERTED_KEY) ?? '[]') as string[] } catch { return [] }
}
function setAlerted(ids: string[]) {
  try { localStorage.setItem(ALERTED_KEY, JSON.stringify(ids.slice(-50))) } catch {}
}

function getDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[] } catch { return [] }
}
function addDismissed(id: string) {
  try {
    const a = getDismissed()
    if (!a.includes(id)) localStorage.setItem(DISMISS_KEY, JSON.stringify([...a, id].slice(-50)))
  } catch { /* storage blocked — banner just reappears next load */ }
}
// Returns true if this is a new login (sid changed) — caller resets dismissals.
function isNewLogin(sid: string | null): boolean {
  if (!sid) return false
  try {
    if (localStorage.getItem(SID_KEY) === sid) return false
    localStorage.setItem(SID_KEY, sid)
    return true
  } catch { return false }
}

const STYLES: Record<Ann['level'], { accent: string; icon: string }> = {
  info:    { accent: '#F5A623', icon: '📣' },
  success: { accent: '#22C55E', icon: '✅' },
  warning: { accent: '#EF4444', icon: '⚠️' },
}

// Global broadcast banners. Polls the role-aware /api/announcement and shows a
// STACK of dismissible messages at the top of every screen. Dismissal is per
// message id (a new post reappears even if an older one was dismissed).
export function Announcement() {
  const [anns, setAnns] = useState<Ann[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const audioRef = useRef<AudioContext | null>(null)

  useEffect(() => { setDismissed(getDismissed()) }, [])

  // Browsers block audio until the user has interacted. Create/resume the
  // AudioContext on the first tap so the urgent beep is allowed afterwards.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        const ctx = audioRef.current ?? new Ctor()
        audioRef.current = ctx
        if (ctx.state === 'suspended') void ctx.resume()
      } catch { /* audio unsupported — visual banner still shows */ }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('touchstart', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
  }, [])

  // Sound + vibration for an Urgent (red) message.
  const urgentAlert = useCallback(() => {
    try { navigator.vibrate?.([140, 70, 140]) } catch { /* unsupported */ }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = audioRef.current ?? new Ctor()
      audioRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      // Two-tone chime so it reads as an alert, not a random blip.
      osc.frequency.setValueAtTime(880, t)
      osc.frequency.setValueAtTime(1175, t + 0.16)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
      osc.start(t)
      osc.stop(t + 0.6)
    } catch { /* blocked until first interaction — banner still shows */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/announcement')
      if (!res.ok) return
      const d = await res.json() as { announcements: Ann[]; sid: string | null }
      // New login → forget previous dismissals AND alerts so everything shows
      // (and re-sounds, if urgent) again.
      if (isNewLogin(d.sid)) {
        try { localStorage.removeItem(DISMISS_KEY); localStorage.removeItem(ALERTED_KEY) } catch {}
        setDismissed([])
      }
      const list = Array.isArray(d.announcements) ? d.announcements : []
      setAnns(list)

      // Sound/vibrate once for any NEW urgent message not yet shown/alerted.
      const dism = getDismissed()
      const alerted = getAlerted()
      const fresh = list.filter((a) => a.level === 'warning' && !alerted.includes(a.id) && !dism.includes(a.id))
      if (fresh.length > 0) {
        urgentAlert()
        setAlerted([...alerted, ...fresh.map((a) => a.id)])
      }
    } catch { /* transient — retry on next tick */ }
  }, [urgentAlert])

  useEffect(() => {
    load()
    const id = window.setInterval(load, 90_000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const visible = anns.filter((a) => !dismissed.includes(a.id))
  if (visible.length === 0) return null

  function dismiss(id: string) {
    addDismissed(id)
    setDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-[80] px-3 flex flex-col gap-2"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      {visible.slice(0, 4).map((ann) => {
        const s = STYLES[ann.level] ?? STYLES.info
        return (
          <div
            key={ann.id}
            role="status"
            aria-live="polite"
            className="max-w-lg w-full mx-auto flex items-stretch gap-0 rounded-2xl overflow-hidden lx-scale-in"
            style={{
              // Solid, high-contrast card so text is clearly readable over any page.
              background: '#17171a',
              border: `1px solid ${s.accent}66`,
              boxShadow: `0 10px 34px rgba(0,0,0,0.5)`,
            }}
          >
            {/* Colored accent bar */}
            <span style={{ width: 5, background: s.accent, flexShrink: 0 }} aria-hidden="true" />
            <div className="flex items-start gap-3 px-4 py-3 flex-1 min-w-0">
              <span className="text-lg shrink-0 leading-6" aria-hidden="true">{s.icon}</span>
              <div className="flex-1 min-w-0">
                {ann.title && <p className="text-[15px] font-bold leading-tight mb-0.5" style={{ color: s.accent }}>{ann.title}</p>}
                <p className="text-sm text-white leading-snug whitespace-pre-wrap break-words">{ann.message}</p>
              </div>
              <button
                onClick={() => dismiss(ann.id)}
                className="-my-1.5 -mr-1.5 w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white/60 hover:text-white active:scale-95 transition-transform"
                aria-label="Dismiss announcement"
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
