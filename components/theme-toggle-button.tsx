'use client'

import { Sun, Moon } from 'lucide-react'
import { useTheme } from './theme-provider'

/**
 * Compact light/dark switch (Lucide sun/moon) for nav bars — e.g. the public
 * landing, so visitors can switch theme right there instead of only in Profile.
 * Toggles between an explicit 'light' and 'dark' preference (persisted by
 * ThemeProvider). On dashboards (forced dark) the resolved theme is always dark,
 * so this simply isn't rendered there.
 */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { resolved, setPref } = useTheme()
  const isLight = resolved === 'light'
  return (
    <button
      type="button"
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Dark mode' : 'Light mode'}
      onClick={() => setPref(isLight ? 'dark' : 'light')}
      className={`lx-theme-btn ${className}`}
    >
      {isLight ? <Moon size={17} strokeWidth={1.9} /> : <Sun size={17} strokeWidth={1.9} />}
    </button>
  )
}
