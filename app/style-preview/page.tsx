import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { EmptyState } from '@/components/ui/empty-state'
import { GlassSheen, PremiumImage } from '@/components/fx'

// TEMPORARY no-auth visual preview of the console dashboard aesthetic.
// Not linked anywhere; used to verify the redesign. Safe to delete.
export const metadata = { robots: { index: false, follow: false } }

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
)

const ORDERS = [
  { id: 'LXF-2026-004182', vendor: 'Mama Chidinma', status: 'PREPARING', amount: '₦3,750', time: '2 min' },
  { id: 'LXF-2026-004181', vendor: 'Campus Bites', status: 'READY', amount: '₦2,500', time: '6 min' },
  { id: 'LXF-2026-004180', vendor: 'Suya Spot', status: 'PICKED_UP', amount: '₦5,200', time: '11 min' },
  { id: 'LXF-2026-004179', vendor: 'Mr Biggs Annex', status: 'DELIVERED', amount: '₦1,800', time: '18 min' },
]
const STATUS: Record<string, string> = {
  PREPARING: 'var(--lx-violet)', READY: 'var(--lx-success)', PICKED_UP: 'var(--lx-blue)', DELIVERED: 'var(--lx-text-faint)',
}

export default function StylePreview() {
  return (
    <div className="lx-page lx-console min-h-screen px-5 py-9 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-5xl">
        <PageHeader
          title="Dashboard"
          subtitle="Daily metrics across the platform — orders, profit, riders and disputes at a glance."
          badge="Admin"
          actions={<span className="lx-mono">12:41</span>}
        />

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-9 lx-stagger">
          <StatCard label="Orders today" value="142" sub="Target 50+ · Month 3" status="ok" href="/style-preview" />
          <StatCard label="Profit / order" value="₦312" sub="Must stay positive" status="ok" />
          <StatCard label="Avg delivery" value="23m" sub="Target under 25 min" status="ok" />
          <StatCard label="Riders online" value="9" sub="Currently active" status="ok" href="/style-preview" />
          <StatCard label="Active disputes" value="2" sub="Needs attention" status="warn" href="/style-preview" />
          <StatCard label="Wallet float" value="₦486,200" sub="Vendor + rider held" status="none" />
        </div>

        {/* Live orders table */}
        <div className="mb-9">
          <div className="flex items-center justify-between mb-4">
            <span className="lx-mono">Live orders</span>
            <span className="lx-mono">{ORDERS.length} active</span>
          </div>
          <div className="lx-surface overflow-hidden">
            <table className="lx-table">
              <thead>
                <tr><th>Order</th><th>Vendor</th><th>Status</th><th className="lx-num">Amount</th><th className="lx-num">Age</th></tr>
              </thead>
              <tbody>
                {ORDERS.map((o) => (
                  <tr key={o.id}>
                    <td className="lx-nums font-medium">{o.id}</td>
                    <td className="text-white/70">{o.vendor}</td>
                    <td><span className="lx-mono" style={{ color: STATUS[o.status] }}>{o.status.replace('_', ' ')}</span></td>
                    <td className="lx-num font-semibold">{o.amount}</td>
                    <td className="lx-num text-white/45">{o.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Image treatment demo (PremiumImage: shimmer → reveal → hover zoom) */}
        <div className="mb-9">
          <span className="lx-mono">Top vendors</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            {[
              { src: '/premium/dish-1.jpg', name: 'Mama Chidinma' },
              { src: '/premium/dish-2.jpg', name: 'Suya Spot' },
              { src: '/premium/dish-3.jpg', name: 'Campus Bites' },
              { src: '/premium/delivery.jpg', name: 'Night Kitchen' },
            ].map((v) => (
              <div key={v.name} className="lx-surface p-2.5">
                <PremiumImage
                  src={v.src}
                  alt={v.name}
                  fill
                  sizes="(max-width: 640px) 50vw, 22vw"
                  frameClassName="aspect-[4/3] rounded-xl mb-2.5"
                />
                <p className="text-sm font-semibold text-white px-0.5">{v.name}</p>
                <p className="lx-mono mt-1 px-0.5">Open · 18 min</p>
              </div>
            ))}
          </div>
        </div>

        {/* Nav grid */}
        <div className="mb-9">
          <span className="lx-mono">Manage</span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
            {['Vendors', 'Riders', 'Orders', 'Disputes', 'Wallets', 'Audit log'].map((label) => (
              <a key={label} href="/style-preview" className="lx-surface lx-focusable p-4 flex items-center gap-3 transition-colors hover:border-white/15">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white/60" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lx-border)' }}>{ICON}</span>
                <div>
                  <p className="font-semibold text-white text-sm">{label}</p>
                  <p className="text-xs text-white/40 mt-0.5">Manage {label.toLowerCase()}</p>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Empty state */}
        <div className="mb-9">
          <span className="lx-mono">Reports</span>
          <div className="mt-4">
            <EmptyState
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>}
              title="No reports yet"
              description="Generated reports will show up here. Run your first one to see daily performance broken down."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
