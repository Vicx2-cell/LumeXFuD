'use client'

import { useTheme, type ThemePref } from './theme-provider'

const OPTS: { value: ThemePref; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'system', label: 'Auto', icon: '🖥️' },
]

/** Segmented Light / Dark / Auto control. Lives in the customer Profile. */
export function ThemeToggle() {
  const { pref, setPref } = useTheme()
  return (
    <div
      className="grid grid-cols-3 gap-1 p-1 rounded-2xl"
      style={{ background: 'var(--lx-surface)', border: '1px solid var(--lx-border)' }}
      role="radiogroup"
      aria-label="Appearance"
    >
      {OPTS.map((o) => {
        const active = pref === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPref(o.value)}
            className="lx-pill h-10 text-sm"
            data-active={active}
          >
            <span aria-hidden="true">{o.icon}</span>
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
