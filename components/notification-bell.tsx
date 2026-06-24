'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Notif {
  id: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pushState, setPushState] = useState<'unknown' | 'unsupported' | 'off' | 'on'>('unknown')
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications ?? [])
      setUnread(data.unread ?? 0)
    } catch { /* offline — keep last state */ }
  }, [])

  // Poll the badge: on mount, every 45s, and whenever the tab regains focus.
  useEffect(() => {
    load()
    const iv = setInterval(load, 45000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [load])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Detect current push state when the panel opens.
  useEffect(() => {
    if (!open) return
    if (!VAPID || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported'); return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushState(sub ? 'on' : 'off'))
      .catch(() => setPushState('off'))
  }, [open])

  const openPanel = async () => {
    setOpen(true)
    setLoading(true)
    await load()
    setLoading(false)
  }

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    setUnread(0)
    try { await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }) } catch { /* retried next poll */ }
  }

  const onItem = async (n: Notif) => {
    if (!n.read_at) {
      setUnread((u) => Math.max(0, u - 1))
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [n.id] }) }).catch(() => {})
    }
    if (n.link) { setOpen(false); router.push(n.link) }
  }

  const enablePush = async () => {
    if (!VAPID) return
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: lib.dom types applicationServerKey as BufferSource; our helper
        // returns Uint8Array<ArrayBufferLike> which TS won't narrow cleanly.
        applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
      })
      const json = sub.toJSON()
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      setPushState('on')
    } catch { /* user dismissed / blocked */ }
  }

  const disablePush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
        await sub.unsubscribe()
      }
      setPushState('off')
    } catch { /* ignore */ }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="w-11 h-11 rounded-full flex items-center justify-center relative"
        style={{ background: 'var(--lx-surface-2)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--lx-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 text-[10px] font-bold rounded-full flex items-center justify-center"
            style={{ background: '#F5A623', color: '#000', minWidth: 18, height: 18, padding: '0 4px' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl overflow-hidden z-50 lx-enter"
          style={{ background: 'var(--lx-surface-solid)', border: '1px solid var(--lx-border)', boxShadow: 'var(--lx-shadow)' }}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--lx-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--lx-text)' }}>Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-semibold lx-amber">Mark all read</button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--lx-text-faint)' }}>Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-2xl mb-1" aria-hidden="true">🔔</div>
                <p className="text-sm" style={{ color: 'var(--lx-text-muted)' }}>You&apos;re all caught up</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--lx-text-faint)' }}>Order updates show up here.</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItem(n)}
                  className="w-full text-left px-4 py-3 flex gap-3 lx-tap"
                  style={{ borderBottom: '1px solid var(--lx-border)', background: n.read_at ? 'transparent' : 'rgba(245,166,35,0.07)' }}
                >
                  <span className="mt-1 shrink-0 w-2 h-2 rounded-full" style={{ background: n.read_at ? 'transparent' : '#F5A623' }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate" style={{ color: 'var(--lx-text)' }}>{n.title}</span>
                    {n.body && <span className="block text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--lx-text-muted)' }}>{n.body}</span>}
                    <span className="block text-[11px] mt-1" style={{ color: 'var(--lx-text-faint)' }}>{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          {pushState !== 'unsupported' && pushState !== 'unknown' && (
            <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--lx-border)' }}>
              <span className="text-xs" style={{ color: 'var(--lx-text-muted)' }}>
                {pushState === 'on' ? 'Push alerts on' : 'Get alerts when the app is closed'}
              </span>
              <button
                type="button"
                onClick={pushState === 'on' ? disablePush : enablePush}
                className="lx-pill h-8 px-3 text-xs"
                data-active={pushState === 'on'}
              >
                {pushState === 'on' ? 'Turn off' : 'Enable'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
