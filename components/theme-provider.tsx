'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

export type ThemePref = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'lx-theme'

// Dashboards stay dark regardless of the saved preference — only the
// customer-facing surface is converted to honour light mode. A browser session
// is single-role, so this is belt-and-braces: if a customer chose light then
// logged in as a vendor in the same browser, the dashboard still renders dark.
const DASHBOARD_RE = /^\/(vendor-dashboard|rider|admin|super-admin)(\/|$)/

/** The pre-hydration script (mirrors applyTheme) — kills the light/dark flash. */
export const themeNoFlashScript = `(function(){try{
var p=location.pathname;
var dash=/^\\/(vendor-dashboard|rider|admin|super-admin)(\\/|$)/.test(p);
var t=localStorage.getItem('${STORAGE_KEY}')||'dark';
if(t==='system'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.documentElement.setAttribute('data-theme',(!dash&&t==='light')?'light':'dark');
}catch(e){}})();`

function resolve(pref: ThemePref, pathname: string): 'dark' | 'light' {
  if (DASHBOARD_RE.test(pathname)) return 'dark'
  if (pref === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }
  return pref
}

interface ThemeCtx {
  pref: ThemePref
  resolved: 'dark' | 'light'
  setPref: (p: ThemePref) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [pref, setPrefState] = useState<ThemePref>('dark')

  // Hydrate the saved preference once on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemePref | null
      if (saved === 'light' || saved === 'system' || saved === 'dark') setPrefState(saved)
    } catch { /* private mode — keep default */ }
  }, [])

  // Apply on every pref / route change (route matters: leaving a dashboard).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolve(pref, pathname))
  }, [pref, pathname])

  // Follow the OS when set to "system".
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => document.documentElement.setAttribute('data-theme', resolve('system', pathname))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref, pathname])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p)
    try { localStorage.setItem(STORAGE_KEY, p) } catch { /* ignore */ }
  }, [])

  return (
    <Ctx.Provider value={{ pref, resolved: resolve(pref, pathname), setPref }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) return { pref: 'dark', resolved: 'dark', setPref: () => {} }
  return ctx
}
