'use client'

import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface AlertBannerProps {
  open: boolean
  title: string
  message: string
  onDismiss: () => void
  autoHideMs?: number
}

export function AlertBanner({ open, title, message, onDismiss, autoHideMs = 6500 }: AlertBannerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(onDismiss, autoHideMs)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [open, autoHideMs, onDismiss])

  if (!open) return null

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[80] w-[min(92vw,34rem)] rounded-2xl border px-4 py-3 shadow-2xl"
      role="alert"
      aria-live="assertive"
      style={{
        top: 'calc(1rem + env(safe-area-inset-top))',
        background: '#1A0F10',
        borderColor: 'rgba(248,113,113,0.38)',
        color: '#FEE2E2',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-red-300" aria-hidden="true">
          <AlertTriangle size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-sm text-red-100/85 mt-1 leading-relaxed">{message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-red-200/70 hover:text-red-100 transition-colors"
          aria-label="Dismiss alert"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
