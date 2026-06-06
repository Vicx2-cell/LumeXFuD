'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// settings is id-keyed with a JSONB value of varying shape
// (e.g. {"amount_kobo": N}, {"value": N}, {"open":"07:00","close":"22:00"}).
interface Setting {
  id: string
  value: unknown
  updated_at: string
}

export default function SuperAdminSettings() {
  const router = useRouter()
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchSettings() {
    const res = await fetch('/api/super-admin/settings')
    if (res.ok) {
      const d = await res.json() as { settings: Setting[] }
      setSettings(d.settings)
    }
    setLoading(false)
  }

  useEffect(() => { fetchSettings() }, [])

  function startEdit(setting: Setting) {
    setEditing(setting.id)
    setEditValue(JSON.stringify(setting.value))
  }

  function cancelEdit() {
    setEditing(null)
    setEditValue('')
  }

  async function saveEdit(id: string) {
    if (!editValue.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(editValue.trim())
    } catch {
      showToast('Value must be valid JSON (e.g. {"amount_kobo": 25000})')
      return
    }
    setSaving(true)
    const res = await fetch('/api/super-admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, value: parsed }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`${id} updated`)
      setEditing(null)
      await fetchSettings()
    } else {
      showToast(d.error ?? 'Save failed')
    }
    setSaving(false)
  }

  // Human-readable rendering of a JSONB setting value. {amount_kobo} shows Naira.
  function displayValue(value: unknown): string {
    if (value && typeof value === 'object' && 'amount_kobo' in value) {
      const n = Number((value as { amount_kobo: unknown }).amount_kobo)
      if (Number.isFinite(n)) return `₦${(n / 100).toLocaleString('en-NG')} (${n} kobo)`
    }
    return JSON.stringify(value)
  }

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: '#0A0A0B' }}>
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1"
              style={{ background: '#F5A623', color: '#000' }}>Super Admin</span>
            <h1 className="text-xl font-bold text-white">Platform Settings</h1>
            <p className="text-sm text-white/40">Live-editable — changes take effect immediately</p>
          </div>
        </div>

        <div className="rounded-2xl mb-5 p-3 flex gap-2"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <span className="text-sm">⚠️</span>
          <p className="text-xs text-red-400">Values are JSON. All price changes apply to new orders instantly. Double-check before saving.</p>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : settings.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No settings found</div>
        ) : (
          <div className="space-y-2">
            {settings.map((s) => (
              <div key={s.id} className="rounded-xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
                {editing === s.id ? (
                  <div>
                    <p className="text-xs text-white/40 font-mono mb-2">{s.id}</p>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-3 font-mono"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(245,166,35,0.4)', color: '#fff' }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(s.id)} disabled={saving}
                        className="flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                        style={{ background: '#F5A623', color: '#000' }}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={cancelEdit} disabled={saving}
                        className="flex-1 py-2 rounded-lg text-sm font-semibold"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/40 font-mono">{s.id}</p>
                      <p className="text-sm font-medium text-white mt-0.5">{displayValue(s.value)}</p>
                      <p className="text-xs text-white/20 mt-1">
                        Updated {new Date(s.updated_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <button onClick={() => startEdit(s)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
                      style={{ background: 'rgba(245,166,35,0.1)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.2)' }}>
                      Edit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
