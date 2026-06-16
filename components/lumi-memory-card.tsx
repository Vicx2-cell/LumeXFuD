'use client'

import { useEffect, useState } from 'react'
import { formatPrice } from '@/lib/money'

interface LumiMemory {
  preferred_name: string | null
  spice_level: 'none' | 'mild' | 'medium' | 'hot' | null
  dietary: string[]
  budget_typical_kobo: number | null
  favourites: string[]
  dislikes: string[]
  notes: string[]
}

type ListField = 'dietary' | 'favourites' | 'dislikes' | 'notes'

const SPICE_LABEL: Record<NonNullable<LumiMemory['spice_level']>, string> = {
  none: 'No pepper', mild: 'Mild', medium: 'Medium', hot: 'Hot 🌶️',
}

function isEmpty(m: LumiMemory): boolean {
  return !m.preferred_name && !m.spice_level && m.budget_typical_kobo == null &&
    m.dietary.length === 0 && m.favourites.length === 0 && m.dislikes.length === 0 && m.notes.length === 0
}

export function LumiMemoryCard() {
  const [memory, setMemory] = useState<LumiMemory | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/lumi/memory')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { memory: LumiMemory | null } | null) => setMemory(d?.memory ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch('/api/lumi/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json() as { memory: LumiMemory | null }
      if (res.ok) setMemory(d.memory)
    } catch {
      // leave state as-is on failure
    } finally {
      setBusy(false)
    }
  }

  function removeFromList(field: ListField, value: string) {
    if (!memory) return
    void patch({ [field]: memory[field].filter((v) => v !== value) })
  }

  function clearScalar(field: 'preferred_name' | 'spice_level' | 'budget_naira') {
    void patch({ [field]: null })
  }

  async function forgetEverything() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/lumi/memory', { method: 'DELETE' })
      if (res.ok) setMemory(null)
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null // skeleton not needed; this is a secondary card

  const empty = !memory || isEmpty(memory)

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.15)' }}>
      <div className="flex items-center gap-2">
        <span className="text-lg">🍲</span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold" style={{ color: '#F5A623' }}>What Lumi remembers</h3>
          <p className="text-[11px] text-white/40">Lumi uses this to know your taste. It&apos;s yours — edit or clear anytime.</p>
        </div>
      </div>

      {empty ? (
        <p className="text-sm text-white/50">
          Lumi hasn&apos;t learned anything about you yet. Chat with Lumi on the home screen and it&apos;ll start to know your taste.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Scalars */}
          {(memory!.preferred_name || memory!.spice_level || memory!.budget_typical_kobo != null) && (
            <div className="space-y-1.5">
              {memory!.preferred_name && (
                <ScalarRow label="Calls you" value={memory!.preferred_name} onClear={() => clearScalar('preferred_name')} busy={busy} />
              )}
              {memory!.spice_level && (
                <ScalarRow label="Spice" value={SPICE_LABEL[memory!.spice_level]} onClear={() => clearScalar('spice_level')} busy={busy} />
              )}
              {memory!.budget_typical_kobo != null && (
                <ScalarRow label="Usual budget" value={`about ${formatPrice(memory!.budget_typical_kobo)}`} onClear={() => clearScalar('budget_naira')} busy={busy} />
              )}
            </div>
          )}

          <ChipGroup title="Loves" field="favourites" items={memory!.favourites} onRemove={removeFromList} busy={busy} />
          <ChipGroup title="Avoids" field="dislikes" items={memory!.dislikes} onRemove={removeFromList} busy={busy} />
          <ChipGroup title="Dietary" field="dietary" items={memory!.dietary} onRemove={removeFromList} busy={busy} />
          <ChipGroup title="Also remembers" field="notes" items={memory!.notes} onRemove={removeFromList} busy={busy} />

          <button
            onClick={forgetEverything}
            disabled={busy}
            className="text-xs py-1.5 disabled:opacity-50"
            style={{ color: '#ef4444' }}
          >
            Make Lumi forget everything
          </button>
        </div>
      )}
    </div>
  )
}

function ScalarRow({ label, value, onClear, busy }: { label: string; value: string; onClear: () => void; busy: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/50">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-white/85">{value}</span>
        <button onClick={onClear} disabled={busy} aria-label={`Clear ${label}`} className="text-white/30 hover:text-white/70 disabled:opacity-40">×</button>
      </span>
    </div>
  )
}

function ChipGroup({ title, field, items, onRemove, busy }: {
  title: string
  field: ListField
  items: string[]
  onRemove: (field: ListField, value: string) => void
  busy: boolean
}) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-white/35 mb-1.5">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)' }}>
            {item}
            <button onClick={() => onRemove(field, item)} disabled={busy} aria-label={`Remove ${item}`}
              className="w-4 h-4 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.08)' }}>×</button>
          </span>
        ))}
      </div>
    </div>
  )
}
