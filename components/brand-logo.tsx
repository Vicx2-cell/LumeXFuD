import Image from 'next/image'
import type { CSSProperties } from 'react'

/**
 * The LumeX Fud brand mark (the amber X icon). Server- and client-safe.
 * Use this anywhere the logo should appear in-app — headers, auth, empty states.
 */
export function BrandLogo({
  size = 36,
  rounded = 11,
  className = '',
  style,
  priority = false,
}: {
  size?: number
  rounded?: number
  className?: string
  style?: CSSProperties
  priority?: boolean
}) {
  return (
    <Image
      src="/icons/icon-512.png"
      alt="LumeX Fud"
      width={size}
      height={size}
      priority={priority}
      className={className}
      style={{ borderRadius: rounded, display: 'block', ...style }}
    />
  )
}
