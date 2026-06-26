'use client'

import { type ReactNode, useEffect } from 'react'

interface ConfirmSheetProps {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  loadingLabel?: string
  /** Red destructive styling on the confirm button. */
  danger?: boolean
  loading?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Premium confirmation bottom-sheet (slides up on mobile, centred dialog on
 * desktop) with a real loading state + inline error. Used for destructive /
 * important customer actions (sign out, delete account) so a tap always gives
 * clear feedback instead of silently firing. Locks body scroll while open and
 * closes on backdrop tap / Escape (unless busy).
 */
export function ConfirmSheet({
  open, title, body, confirmLabel, loadingLabel, danger, loading, error, onConfirm, onCancel,
}: ConfirmSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, loading, onCancel])

  if (!open) return null
  return (
    <div
      className="lx-scrim fixed inset-0 z-[90] flex items-end sm:items-center justify-center px-0 sm:px-4"
      style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(2px)' }}
      onClick={() => { if (!loading) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="lx-sheet w-full sm:max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-5 rounded-t-3xl sm:rounded-3xl border border-white/10"
          style={{ background: 'var(--lx-surface-solid)', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' }}
        >
          <div className="w-10 h-1 rounded-full bg-white/15 mx-auto mb-4 sm:hidden" aria-hidden="true" />
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <div className="text-sm text-white/60 mt-1.5 leading-relaxed">{body}</div>
          {error && <p className="text-sm mt-3" style={{ color: 'var(--lx-danger)' }}>{error}</p>}
          <div className="flex flex-col gap-2 mt-5">
            <button
              onClick={onConfirm}
              disabled={loading}
              className="w-full rounded-xl py-3.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-70 transition-opacity"
              style={danger ? { background: 'var(--lx-danger)', color: '#fff' } : { background: 'var(--color-amber)', color: '#000' }}
            >
              {loading && <span className="lx-spinner" aria-hidden="true" />}
              {loading ? (loadingLabel ?? 'Working…') : confirmLabel}
            </button>
            <button
              onClick={onCancel}
              disabled={loading}
              className="w-full rounded-xl py-3 text-sm font-medium text-white/70 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
