'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Magnetic } from '@/components/fx'
import { ThemeToggleButton } from '@/components/theme-toggle-button'

/**
 * Landing nav that floats transparently over the full-bleed hero photo and only
 * gains its glass background + hairline once you scroll past the fold (~40px).
 * This is what lets the hero read as a distinct cinematic panel rather than a
 * photo capped by the same dark bar as the rest of the site.
 */
export function LandingNav() {
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`lx-landing-nav ${solid ? 'lx-landing-nav--solid' : ''}`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-2">
        <span className="lx-display font-bold text-lg tracking-tight shrink-0">
          <span className="lx-amber">LumeX</span> Fud
        </span>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <ThemeToggleButton />
          <Link
            href="/auth"
            className="px-3 sm:px-4 py-2 text-sm font-medium text-white/85 hover:text-white transition-colors"
          >
            Login
          </Link>
          <Magnetic>
            <Link
              href="/auth/register"
              className="lx-btn-amber px-3 sm:px-4 py-2 text-sm whitespace-nowrap"
            >
              Create account
            </Link>
          </Magnetic>
        </div>
      </div>
    </nav>
  )
}
