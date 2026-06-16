'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'

type Audience = 'ALL' | 'CUSTOMER' | 'VENDOR' | 'RIDER'
type Level = 'info' | 'warning' | 'success'

interface CurrentAnn {
  id: string
  title: string | null
  message: string
  audience: Audience
  level: Level
  scheduled_at: string | null
  expires_at: string | null
  created_at: string
}

// datetime-local string (local time) → ISO, or null if empty.
function localToIso(local: string): string | null {
  if (!local) return null
  const t = new Date(local).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: 'ALL', label: 'Everyone' },
  { key: 'CUSTOMER', label: 'Customers' },
  { key: 'VENDOR', label: 'Vendors' },
  { key: 'RIDER', label: 'Riders' },
]

const LEVELS: { key: Level; label: string; color: string; icon: string }[] = [
  { key: 'info', label: 'Info', color: '#F5A623', icon: '📣' },
  { key: 'success', label: 'Good news', color: '#22C55E', icon: '✅' },
  { key: 'warning', label: 'Urgent', color: '#EF4444', icon: '⚠️' },
]

export default function AnnouncePage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState<Audience>('ALL')
  const [level, setLevel] = useState<Level>('info')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [showAt, setShowAt] = useState('')   // datetime-local
  const [autoHide, setAutoHide] = useState('') // datetime-local (optional)
  const [list, setList] = useState<CurrentAnn[]>([])
  const [busy, setBusy] = useState(false)
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  async function loadList() {
    try {
      const res = await fetch('/api/super-admin/announcement')
      if (res.status === 401 || res.status === 403) { router.push('/auth'); return }
      if (res.ok) {
        const d = await res.json() as { announcements: CurrentAnn[] }
        setList(Array.isArray(d.announcements) ? d.announcements : [])
      }
    } catch { /* non-fatal */ }
  }

  useEffect(() => { loadList() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function publish() {
    if (message.trim().length < 1) { setError('Write a message first'); return }

    let scheduledIso: string | null = null
    if (when === 'later') {
      scheduledIso = localToIso(showAt)
      if (!scheduledIso) { setError('Pick a date and time to show it'); return }
      if (new Date(scheduledIso).getTime() <= Date.now()) { setError('Scheduled time must be in the future'); return }
    }
    const expiresIso = localToIso(autoHide)
    if (expiresIso && new Date(expiresIso).getTime() <= (scheduledIso ? new Date(scheduledIso).getTime() : Date.now())) {
      setError('Auto-hide time must be after it shows'); return
    }

    setBusy(true); setError('')
    try {
      const res = await fetch('/api/super-admin/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          title: title.trim() || undefined,
          audience,
          level,
          scheduled_at: scheduledIso,
          expires_at: expiresIso,
        }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) {
        showToast(when === 'later' ? 'Scheduled — it’ll appear at the set time' : 'Posted — it’s on their screens now')
        setTitle(''); setMessage(''); setWhen('now'); setShowAt(''); setAutoHide('')
        loadList()
      } else {
        setError(d.error ?? 'Could not publish')
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function clearOne(id: string) {
    setClearingId(id); setError('')
    try {
      const res = await fetch(`/api/super-admin/announcement?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok) { showToast('Cleared — banner removed'); setList((prev) => prev.filter((a) => a.id !== id)) }
      else { const d = await res.json().catch(() => ({})) as { error?: string }; setError(d.error ?? 'Could not clear') }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setClearingId(null)
    }
  }

  const levelMeta = LEVELS.find((l) => l.key === level)!

  return (
    <div className="lx-page px-5 py-10 overflow-hidden">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="mx-auto max-w-lg lx-enter">
        <div className="mb-6 flex items-center gap-3"><BackButton /><h1 className="text-xl font-bold text-white">Broadcast a message</h1></div>

        {/* All current announcements — each cleared independently */}
        {list.length > 0 && (
          <div className="mb-5 space-y-2.5">
            <p className="text-xs uppercase tracking-wide text-white/40">Active messages ({list.length})</p>
            {list.map((a) => {
              const scheduledFuture = a.scheduled_at && new Date(a.scheduled_at).getTime() > Date.now()
              const expired = a.expires_at && new Date(a.expires_at).getTime() <= Date.now()
              const statusLabel = expired ? 'Ended' : scheduledFuture ? `Scheduled · ${fmtWhen(a.scheduled_at!)}` : 'Live now'
              const statusColor = expired ? 'rgba(255,255,255,0.4)' : scheduledFuture ? '#60a5fa' : '#22C55E'
              return (
                <div key={a.id} className="glass-thin p-4">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: statusColor }}>
                      {statusLabel} · {AUDIENCES.find((x) => x.key === a.audience)?.label}
                    </span>
                    <button onClick={() => clearOne(a.id)} disabled={clearingId === a.id} className="text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-50 shrink-0" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                      {clearingId === a.id ? 'Clearing…' : 'Clear'}
                    </button>
                  </div>
                  {a.title && <p className="text-sm font-semibold text-white">{a.title}</p>}
                  <p className="text-sm text-white/80 whitespace-pre-wrap">{a.message}</p>
                  {a.expires_at && !expired && <p className="text-[11px] text-white/35 mt-1.5">Auto-hides {fmtWhen(a.expires_at)}</p>}
                </div>
              )
            })}
          </div>
        )}

        {/* Compose */}
        <div className="glass-thin p-5 space-y-4">
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="e.g. We’re open late tonight"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400 transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
          </div>

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} placeholder="What do you want them to see?" rows={3}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none focus:border-amber-400 transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
            <p className="text-[11px] text-white/30 mt-1 text-right">{message.length}/500</p>
          </div>

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Who sees it?</label>
            <div className="grid grid-cols-4 gap-2">
              {AUDIENCES.map((a) => (
                <button key={a.key} onClick={() => setAudience(a.key)}
                  className="py-2.5 rounded-xl text-xs font-medium transition-colors"
                  style={{ background: audience === a.key ? '#F5A623' : 'rgba(255,255,255,0.06)', color: audience === a.key ? '#000' : 'rgba(255,255,255,0.7)', border: `1px solid ${audience === a.key ? '#F5A623' : 'rgba(255,255,255,0.1)'}` }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Style</label>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button key={l.key} onClick={() => setLevel(l.key)}
                  className="py-2.5 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                  style={{ background: level === l.key ? `${l.color}22` : 'rgba(255,255,255,0.06)', color: level === l.key ? l.color : 'rgba(255,255,255,0.7)', border: `1px solid ${level === l.key ? l.color : 'rgba(255,255,255,0.1)'}` }}>
                  <span>{l.icon}</span>{l.label}
                </button>
              ))}
            </div>
          </div>

          {/* When to show */}
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">When</label>
            <div className="grid grid-cols-2 gap-2">
              {([['now', 'Show now'], ['later', 'Schedule']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setWhen(key)}
                  className="py-2.5 rounded-xl text-xs font-medium transition-colors"
                  style={{ background: when === key ? '#F5A623' : 'rgba(255,255,255,0.06)', color: when === key ? '#000' : 'rgba(255,255,255,0.7)', border: `1px solid ${when === key ? '#F5A623' : 'rgba(255,255,255,0.1)'}` }}>
                  {label}
                </button>
              ))}
            </div>
            {when === 'later' && (
              <div className="mt-2">
                <input type="datetime-local" value={showAt} onChange={(e) => setShowAt(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', colorScheme: 'dark' }} />
              </div>
            )}
            <div className="mt-2">
              <label className="text-[11px] text-white/40 mb-1 block">Auto-hide (optional)</label>
              <input type="datetime-local" value={autoHide} onChange={(e) => setAutoHide(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', colorScheme: 'dark' }} />
            </div>
          </div>

          {/* Live preview */}
          {message.trim() && (
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Preview</label>
              <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: `${levelMeta.color}22`, border: `1px solid ${levelMeta.color}66` }}>
                <span className="text-base shrink-0">{levelMeta.icon}</span>
                <div className="flex-1 min-w-0">
                  {title.trim() && <p className="text-sm font-semibold" style={{ color: levelMeta.color }}>{title}</p>}
                  <p className="text-sm text-white/90 whitespace-pre-wrap break-words">{message}</p>
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button onClick={publish} disabled={busy || !message.trim()} className="lx-btn-amber w-full py-3.5 disabled:opacity-50">
            {busy ? 'Saving…' : when === 'later' ? 'Schedule it' : 'Post to their screens'}
          </button>
          <p className="text-[11px] text-white/30 text-center">Adds a banner (multiple can run at once). It shows again each time they log in, until you clear it or it auto-hides. Appears within ~1–2 min (instantly on next app open).</p>
        </div>
      </div>
    </div>
  )
}
