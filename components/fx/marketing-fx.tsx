'use client'

import { CursorProvider } from './cursor-provider'
import { GlowField } from './glow-field'

/**
 * Client island that mounts the marketing-only atmosphere (custom cursor +
 * pointer-tracking glow) on a server-rendered marketing page. Each child guards
 * itself for touch / reduced-motion, so this is inert on phones.
 */
export function MarketingFx() {
  return (
    <>
      <CursorProvider />
      <GlowField track />
    </>
  )
}
