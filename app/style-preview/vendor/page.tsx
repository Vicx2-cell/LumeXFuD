import { GlassSheen } from '@/components/fx'

// TEMPORARY no-auth preview of the re-architected VENDOR dashboard arrangement.
// Not linked; used to verify the layout. Safe to delete.
export const metadata = { robots: { index: false, follow: false } }

const ORDERS = [
  { n: 'LXF-2026-004182', who: 'Chidera O.', items: '2× Jollof + Chicken', amt: '₦3,750', status: 'NEW', accent: 'var(--color-amber)' },
  { n: 'LXF-2026-004181', who: 'Emeka N.',  items: '1× Fried rice combo',  amt: '₦2,500', status: 'PREPARING', accent: 'var(--lx-violet)' },
]
const MANAGE = [
  { icon: '🍽️', label: 'Menu & items',     desc: 'Add, edit & price your food' },
  { icon: '💰', label: 'Earnings & payout', desc: 'Balance, withdrawals & bank' },
  { icon: '⭐', label: 'Reviews',           desc: 'What customers are saying' },
  { icon: '⚙️', label: 'Settings',          desc: 'Store, hours, pickup, security' },
]

export default function VendorPreview() {
  return (
    <div className="lx-page lx-console min-h-screen pb-16 overflow-hidden">
      <GlassSheen />
      {/* Header */}
      <div className="sticky top-0 z-40 lx-surface" style={{ borderRadius: 0 }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="lx-mono">Vendor</p>
            <p className="font-semibold text-white leading-tight">Mama Chidinma Kitchen</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(52,211,153,0.14)', color: 'var(--lx-success)' }}>● Open</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* LIVE */}
        <p className="lx-mono px-1">Live</p>
        <div className="lx-surface p-4 space-y-3">
          <p className="text-sm font-semibold text-white/80">Shop status</p>
          <div className="grid grid-cols-3 gap-2">
            {(['OPEN', 'BUSY', 'CLOSED'] as const).map((s) => (
              <div key={s} className="py-3 rounded-xl text-sm font-semibold text-center"
                style={s === 'OPEN' ? { background: '#4ade80', color: '#000' } : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {s}
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {[{ l: 'New', v: 3, c: 'var(--color-amber)' }, { l: 'Preparing', v: 2, c: 'var(--lx-violet)' }, { l: 'Ready', v: 1, c: 'var(--lx-success)' }].map((s) => (
            <div key={s.l} className="lx-surface rounded-2xl px-3 py-3 text-center">
              <p className="lx-display text-2xl font-bold tabular-nums leading-none" style={{ color: s.c }}>{s.v}</p>
              <p className="text-[11px] text-white/45 mt-1.5">{s.l}</p>
            </div>
          ))}
        </div>

        {/* ORDERS */}
        <div className="flex items-center gap-2 pt-2">
          <h2 className="text-sm font-semibold text-white/80">Active orders</h2>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#F5A623', color: '#000' }}>{ORDERS.length}</span>
        </div>
        <div className="space-y-2.5">
          {ORDERS.map((o) => (
            <div key={o.n} className="lx-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="lx-nums text-sm font-semibold text-white">{o.n}</p>
                <span className="lx-mono" style={{ color: o.accent }}>{o.status}</span>
              </div>
              <p className="text-sm text-white/70 mt-1.5">{o.items}</p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-white/45">{o.who}</p>
                <p className="text-sm font-semibold lx-nums lx-amber">{o.amt}</p>
              </div>
            </div>
          ))}
        </div>

        {/* MANAGE */}
        <p className="lx-mono px-1 pt-2">Manage</p>
        <div className="lx-surface overflow-hidden">
          {MANAGE.map((m, i) => (
            <div key={m.label} className={`flex items-center gap-3 p-4${i > 0 ? ' border-t border-white/6' : ''}`}>
              <span className="text-xl shrink-0">{m.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/85">{m.label}</p>
                <p className="text-xs text-white/40">{m.desc}</p>
              </div>
              <span className="text-white/30">→</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
