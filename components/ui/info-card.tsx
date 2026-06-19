import type { HTMLAttributes, ReactNode } from 'react'

/**
 * Accent info panel — consolidates the repeated amber/neutral container
 * styling. `tone` picks the surface; callers keep their own padding/rounding
 * (Tailwind) so it composes cleanly. Optional `icon` renders a `.lx-icon-badge`.
 */
export function InfoCard({
  tone = 'amber',
  icon,
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: 'amber' | 'amber-soft' | 'amber-strong'
  icon?: ReactNode
}) {
  const toneClass =
    tone === 'amber-soft' ? 'lx-card-amber-soft'
    : tone === 'amber-strong' ? 'lx-card-amber-strong'
    : 'lx-card-amber'
  return (
    <div className={`${toneClass} ${className}`} {...props}>
      {icon != null ? (
        <div className="flex items-start gap-3">
          <span className="lx-icon-badge w-10 h-10 shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
