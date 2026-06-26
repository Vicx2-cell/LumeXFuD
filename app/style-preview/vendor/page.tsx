import { GlassSheen, Sparkline } from '@/components/fx'
import {
  UtensilsCrossed, Wallet, Star, Settings2, Bell, TrendingUp, ChevronRight,
} from 'lucide-react'

// TEMPORARY no-auth preview of the elevated VENDOR dashboard. Not linked.
export const metadata = { robots: { index: false, follow: false } }

const ORDERS = [
  { n: 'LXF-2026-04821', who: 'Chioma O.', where: 'Faith Lodge', items: '2 items', amt: '₦3,750', status: 'New', c: 'var(--color-amber)', ago: '2m', av: '#F5A623', init: 'CO' },
  { n: 'LXF-2026-04820', who: 'Emeka N.',  where: 'Chic Hostel', items: '1 item',  amt: '₦2,500', status: 'Preparing', c: 'var(--lx-violet)', ago: '6m', av: '#a78bfa', init: 'EN' },
  { n: 'LXF-2026-04819', who: 'Aisha B.',  where: 'Annex B',     items: '3 items', amt: '₦5,200', status: 'Ready', c: 'var(--lx-green)', ago: '11m', av: '#34d399', init: 'AB' },
]
const MANAGE = [
  { Icon: UtensilsCrossed, label: 'Menu & items',     desc: 'Add, edit & price your food' },
  { Icon: Wallet,          label: 'Earnings & payout', desc: 'Balance, withdrawals & bank' },
  { Icon: Star,            label: 'Reviews',           desc: 'What customers are saying' },
  { Icon: Settings2,       label: 'Settings',          desc: 'Store, hours, pickup, security' },
]
// New | Preparing | Ready | Out — pipeline shape
const PIPE = [{ v: 3, c: 'var(--color-amber)' }, { v: 2, c: 'var(--lx-blue)' }, { v: 1, c: 'var(--lx-green)' }, { v: 4, c: 'rgba(255,255,255,0.18)' }]

export default function VendorPreview() {
  return (
    <div className="lx-page lx-console min-h-screen pb-16 overflow-hidden">
      <GlassSheen />

      {/* Header */}
      <div className="sticky top-0 z-40 lx-surface" style={{ borderRadius: 0, boxShadow: 'none' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="lx-mono-av" style={{ ['--av' as string]: '#F5A623' }}>MC</span>
            <div className="min-w-0">
              <p className="lx-mono">Vendor</p>
              <p className="font-semibold text-white leading-tight truncate">Mama Chidinma</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-white/55">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full" style={{ color: 'var(--lx-green)', background: 'color-mix(in srgb, var(--lx-green) 14%, transparent)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--lx-green)', boxShadow: '0 0 8px var(--lx-green)' }} />Open
            </span>
            <button className="w-9 h-9 rounded-full grid place-items-center"><Bell size={18} strokeWidth={1.75} /></button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* TODAY hero — one big number + sparkline */}
        <div className="lx-surface p-5">
          <div className="flex items-start justify-between">
            <p className="lx-mono">Today · Revenue</p>
            <span className="inline-flex items-center gap-1 text-xs font-semibold lx-nums" style={{ color: 'var(--lx-green)' }}>
              <TrendingUp size={13} strokeWidth={2} /> 12%
            </span>
          </div>
          <p className="lx-hero-num mt-2">₦48,500</p>
          <p className="text-[13px] text-white/55 mt-1 lx-nums">23 orders · vs ₦43,200 yesterday</p>
          <div className="mt-3 -mx-1">
            <Sparkline data={[12, 18, 9, 22, 16, 28, 21, 31, 26, 34]} height={56} />
          </div>
        </div>

        {/* Shop status — sliding segmented control */}
        <div className="lx-surface p-4 space-y-3">
          <p className="lx-mono">Shop status</p>
          <div className="lx-seg" style={{ ['--seg-n' as string]: 3, ['--seg-i' as string]: 0, ['--seg-tint' as string]: '#34d399' }}>
            <span className="lx-seg-pill" />
            <button className="lx-seg-opt" data-on="true">OPEN</button>
            <button className="lx-seg-opt">BUSY</button>
            <button className="lx-seg-opt">CLOSED</button>
          </div>
          {/* Pipeline shape */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white/45">Order pipeline</span>
              <span className="text-xs text-white/45 lx-nums">10 active</span>
            </div>
            <div className="lx-pipe">
              {PIPE.map((p, i) => <span key={i} style={{ flexGrow: p.v, background: p.c }} />)}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-white/50 lx-nums">
              <span><b className="text-white/80">3</b> New</span>
              <span><b className="text-white/80">2</b> Preparing</span>
              <span><b className="text-white/80">1</b> Ready</span>
            </div>
          </div>
        </div>

        {/* ORDERS */}
        <div className="flex items-center justify-between pt-1">
          <p className="lx-mono">Active orders</p>
          <span className="text-xs text-white/45 lx-nums">{ORDERS.length} live</span>
        </div>
        <div className="lx-surface overflow-hidden">
          {ORDERS.map((o) => (
            <div key={o.n} className="lx-row">
              <span className="lx-mono-av" style={{ ['--av' as string]: o.av }}>{o.init}</span>
              <div className="min-w-0">
                <p className="text-sm text-white truncate" style={{ fontWeight: 550 }}>{o.n} · {o.items}</p>
                <p className="text-[12.5px] text-white/40 truncate mt-0.5">{o.who} · {o.where}</p>
              </div>
              <div className="lx-row-r">
                <p className="text-sm font-semibold text-white lx-nums">{o.amt}</p>
                <span className="lx-spill" style={{ ['--c' as string]: o.c }}>{o.status}</span>
                <time className="text-[11px] text-white/35 lx-nums">{o.ago}</time>
              </div>
            </div>
          ))}
        </div>

        {/* MANAGE */}
        <p className="lx-mono px-1 pt-1">Manage</p>
        <div className="lx-surface overflow-hidden">
          {MANAGE.map(({ Icon, label, desc }, i) => (
            <div key={label} className={`flex items-center gap-3 p-4${i > 0 ? ' border-t border-white/[0.06]' : ''}`}>
              <span className="w-9 h-9 rounded-xl grid place-items-center text-white/55" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lx-border)' }}>
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90">{label}</p>
                <p className="text-xs text-white/40">{desc}</p>
              </div>
              <ChevronRight size={16} strokeWidth={2} className="text-white/30" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
