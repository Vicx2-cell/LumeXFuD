import type { ReactNode } from 'react'
import Link from 'next/link'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: string
  /** Drives the corner status dot colour. */
  status?: 'ok' | 'warn' | 'critical' | 'none'
  /** If set, the whole tile is a link. */
  href?: string
}

/**
 * Premium KPI tile: an uppercase tracked label, a big tabular-nums display
 * value, an optional context line, and a small status dot. Value stays neutral
 * (never coloured) — colour lives only in the dot/delta, per the dashboard spec.
 * Renders as a link when `href` is set (server-safe — plain <a>, no router).
 */
export function StatCard({ label, value, sub, status = 'none', href }: StatCardProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="lx-kpi-label">{label}</span>
        {status !== 'none' && <span className="lx-statcard-dot" data-status={status} />}
      </div>
      <p className="lx-kpi-value mt-2">{value}</p>
      {sub && <p className="lx-kpi-sub">{sub}</p>}
    </>
  )
  if (href) {
    return (
      <Link href={href} className="lx-statcard lx-focusable">
        {inner}
      </Link>
    )
  }
  return <div className="lx-statcard">{inner}</div>
}
