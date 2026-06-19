'use client'

import { useState } from 'react'

// Compact "business hours" editor for the vendor and rider dashboards. Collapsed
// to a single row by default (shows the saved hours); tap to expand two native
// time pickers + Save. Display only — these times don't open/close the account.
export function BusinessHours({
  role,
  id,
  initialOpen,
  initialClose,
}: {
  role: 'vendor' | 'rider'
  id: string
  initialOpen: string | null
  initialClose: string | null
}) {
  const [open, setOpen] = useState(initialOpen ?? '')
  const [close, setClose] = useState(initialClose ?? '')
  const [savedOpen, setSavedOpen] = useState(initialOpen ?? '')
  const [savedClose, setSavedClose] = useState(initialClose ?? '')
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const label = role === 'vendor' ? 'Opening hours' : 'Working hours'
  const endpoint = role === 'vendor' ? `/api/vendors/${id}/hours` : `/api/riders/${id}/hours`
  const summary = savedOpen && savedClose ? `${savedOpen} – ${savedClose}` : 'Not set'

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Native time inputs give "" when cleared — send null so the field resets.
        body: JSON.stringify({ opening_time: open || null, closing_time: close || null }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) {
        setSavedOpen(open)
        setSavedClose(close)
        setMsg('Saved')
        setExpanded(false)
      } else {
        setMsg(d.error ?? 'Could not save')
      }
    } catch {
      setMsg('Network error. Please try again.')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
  } as const

  return (
    <div className="glass-thin px-4 py-3">
      {/* Collapsed summary row — tap to edit */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs text-white/40 uppercase tracking-widest">{label}</span>
        <span className="flex items-center gap-2">
          {msg && <span className="text-xs" style={{ color: msg === 'Saved' ? '#4ade80' : '#f87171' }}>{msg}</span>}
          <span className="text-sm font-medium tabular-nums" style={{ color: savedOpen ? '#F5A623' : 'rgba(255,255,255,0.35)' }}>
            {summary}
          </span>
          <span className="text-white/30 text-xs">{expanded ? '▲' : '▾'}</span>
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-white/45">Opens</span>
              <input type="time" value={open} onChange={(e) => setOpen(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            </label>
            <label className="block">
              <span className="text-[11px] text-white/45">Closes</span>
              <input type="time" value={close} onChange={(e) => setClose(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 rounded-xl text-sm" style={inputStyle} />
            </label>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: '#F5A623', color: '#000' }}
          >
            {saving ? 'Saving…' : 'Save hours'}
          </button>
        </div>
      )}
    </div>
  )
}
