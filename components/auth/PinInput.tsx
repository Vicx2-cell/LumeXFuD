'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

interface PinInputProps {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  error?: string
  disabled?: boolean
  label?: string
  length?: number
  /** When true, plays the success burst (caller sets this right before navigating away). */
  success?: boolean
}

/** Small haptic helper — no-ops where the Vibration API is unavailable (iOS Safari, desktop). */
function buzz(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern) } catch { /* ignore */ }
  }
}

export default function PinInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  label,
  length = 6,
  success = false,
}: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  // Bumped each time a new error arrives so the shake animation re-triggers.
  const [shakeKey, setShakeKey] = useState(0)
  const prevErr = useRef('')

  // Autofocus so the keypad / keyboard is ready immediately (iPhone-unlock feel).
  useEffect(() => {
    if (!disabled) inputRef.current?.focus()
  }, [disabled])

  // Re-arm shake + error haptic whenever a fresh error appears.
  useEffect(() => {
    if (error && error !== prevErr.current) {
      setShakeKey((k) => k + 1)
      buzz([0, 35, 40, 35])
    }
    prevErr.current = error ?? ''
  }, [error])

  // Success haptic.
  useEffect(() => {
    if (success) buzz(30)
  }, [success])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, '').slice(0, length)
    if (next.length > value.length) buzz(8) // tap feedback on each new digit
    onChange(next)
    if (next.length === length && onComplete) onComplete(next)
  }, [length, onChange, onComplete, value.length])

  const cells = Array.from({ length })

  return (
    <div className="space-y-4">
      {label && (
        <label
          htmlFor="lx-pin"
          className="block text-center text-xs font-medium text-white/60"
        >
          {label}
        </label>
      )}

      {/* The whole row is a label for the hidden input — tap anywhere to type. */}
      <label
        htmlFor="lx-pin"
        key={shakeKey}
        className={`flex justify-center gap-3 max-[360px]:gap-2 cursor-text ${error ? 'lx-shake' : ''}`}
        aria-hidden="true"
      >
        {cells.map((_, i) => {
          const filled = i < value.length
          const active = focused && i === value.length && !success
          const borderColor = success
            ? '#34d399'
            : error
              ? '#ef4444'
              : active
                ? '#F5A623'
                : 'rgba(255,255,255,0.12)'
          return (
            <div
              key={i}
              className="relative flex items-center justify-center w-12 h-14 max-[360px]:w-[2.6rem] rounded-2xl transition-colors"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: `1.5px solid ${borderColor}`,
                boxShadow: active ? '0 0 0 4px rgba(245,166,35,0.18)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              {filled && (
                <span
                  className="lx-pop block rounded-full"
                  style={{
                    width: 14,
                    height: 14,
                    background: success ? '#34d399' : '#F5A623',
                    boxShadow: `0 0 12px ${success ? 'rgba(52,211,153,0.6)' : 'rgba(245,166,35,0.6)'}`,
                  }}
                />
              )}
              {active && !filled && (
                <span className="block w-0.5 h-6 rounded-full bg-amber-400/70 animate-pulse" />
              )}
            </div>
          )
        })}
      </label>

      {/* Real input — visually hidden but focusable & screen-reader friendly. */}
      <input
        ref={inputRef}
        id="lx-pin"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        aria-label={label ?? 'PIN'}
        aria-invalid={!!error}
        className="absolute opacity-0 w-px h-px -z-10"
        style={{ left: -9999 }}
      />

      <p className="text-center text-sm min-h-[1.25rem]" aria-live="polite" role="status">
        {error
          ? <span className="text-red-400">{error}</span>
          : success
            ? <span className="text-emerald-400">Unlocked ✓</span>
            : null}
      </p>
    </div>
  )
}
