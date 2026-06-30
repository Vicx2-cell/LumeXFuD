import Link from 'next/link'

export interface Crumb { name: string; href?: string }

// Visible breadcrumb trail (the JSON-LD BreadcrumbList is emitted separately by
// each page). Helps users orient and gives Google the site hierarchy.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-white/45 mb-4">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={i} className="inline-flex items-center gap-1.5">
              {c.href && !last ? (
                <Link href={c.href} className="hover:text-white/80 transition-colors">{c.name}</Link>
              ) : (
                <span className={last ? 'text-white/70' : ''} aria-current={last ? 'page' : undefined}>{c.name}</span>
              )}
              {!last && <span aria-hidden="true" className="text-white/25">/</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
