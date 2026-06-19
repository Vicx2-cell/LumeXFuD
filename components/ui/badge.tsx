import type { CSSProperties, ReactNode } from 'react'

/**
 * Status badge — a soft tinted chip. Pass a colour (hex or a CSS var like
 * `var(--lx-green)`); the chip derives a matching translucent background.
 * Purely presentational; callers own the status→colour/label mapping.
 */
export function Badge({
  color = 'rgba(255,255,255,0.6)',
  children,
  className = '',
}: {
  color?: string
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`lx-badge ${className}`} style={{ '--badge': color } as CSSProperties}>
      {children}
    </span>
  )
}
