import type { ReactNode } from 'react'
import { BackButton } from '@/components/back-button'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Small role/eyebrow chip (e.g. "Admin", "Super Admin"). */
  badge?: string
  /** Show the back button (default true). */
  back?: boolean
  /** Right-aligned actions (buttons, refresh, logout). */
  actions?: ReactNode
}

/**
 * One shared page header for every dashboard surface: optional back + role chip
 * row, a display title with subtitle, right-aligned actions, and a single
 * hairline divider under it. The hairline + consistent title scale is the
 * biggest "clean/premium" lever (replaces the ad-hoc back+title each admin page
 * was rolling itself). Server-safe (no hooks).
 */
export function PageHeader({ title, subtitle, badge, back = true, actions }: PageHeaderProps) {
  return (
    <header className="lx-ph">
      {(back || badge || actions) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {back && <BackButton />}
            {badge && <span className="lx-ph-badge">{badge}</span>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <h1 className="lx-ph-title">{title}</h1>
      {subtitle && <p className="lx-ph-sub">{subtitle}</p>}
      <div className="lx-hairline mt-4" />
    </header>
  )
}
