import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** Drop the glass surface (when already inside a card). */
  bare?: boolean
}

/**
 * Consistent empty state for every list/data surface: a muted icon badge, a
 * one-line title, a muted sentence, and an optional single action. Replaces the
 * bare "No orders found" text divs so empty surfaces never look broken.
 */
export function EmptyState({ icon, title, description, action, bare = false }: EmptyStateProps) {
  return (
    <div className={`lx-empty ${bare ? '' : 'glass-thin'}`}>
      {icon && <span className="lx-empty-icon">{icon}</span>}
      <p className="lx-empty-title">{title}</p>
      {description && <p className="lx-empty-desc">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
