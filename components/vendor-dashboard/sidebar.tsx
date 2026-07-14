'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  CircleDollarSign,
  Grid2x2,
  MenuSquare,
  LifeBuoy,
  Newspaper,
  Settings2,
  Video,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatClock, initials, type VendorDashboardVendor } from './helpers'

type SidebarItem = {
  label: string
  href?: string
  scrollToId?: string
  desc: string
  icon: typeof Grid2x2
}

const ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/vendor-dashboard', desc: 'Live orders and store health', icon: Grid2x2 },
  { label: 'Orders', href: '/vendor-dashboard/orders', desc: 'Incoming queue and actions', icon: MenuSquare },
  { label: 'Menu', href: '/vendor-dashboard/menu', desc: 'Edit items and availability', icon: MenuSquare },
  { label: 'Store', href: '/vendor-dashboard/store', desc: 'Store info and hours', icon: Settings2 },
  { label: 'Videos', href: '/vendor-dashboard/videos', desc: 'Manage clips and drafts', icon: Video },
  { label: 'Reviews', href: '/vendor-dashboard/reviews', desc: 'Ratings and customer feedback', icon: Newspaper },
  { label: 'Earnings', href: '/vendor-dashboard/earnings', desc: 'Payouts and revenue history', icon: CircleDollarSign },
  { label: 'Share', href: '/vendor-dashboard/share', desc: 'Store link', icon: ArrowUpRight },
  { label: 'Settings', href: '/vendor-dashboard/settings', desc: 'Store profile and access', icon: Settings2 },
  { label: 'Support', href: '/vendor-dashboard/support', desc: 'Report an issue', icon: LifeBuoy },
]

function NavButton({
  item,
  active,
  onNavigate,
}: {
  item: SidebarItem
  active?: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  const content = (
    <span
      className={`group flex items-start gap-3 rounded-2xl border px-3 py-3 transition-all ${active ? 'border-[rgba(245,166,35,0.38)] bg-[rgba(245,166,35,0.10)] shadow-[0_0_0_1px_rgba(245,166,35,0.08)]' : 'border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.055]'}`}
    >
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${active ? 'border-[rgba(245,166,35,0.28)] bg-[rgba(245,166,35,0.16)] text-[#F5A623]' : 'border-white/8 bg-white/[0.04] text-white/80'}`}>
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{item.label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-white/42">{item.desc}</span>
      </span>
      <span className="mt-0.5 text-white/28 transition-transform group-hover:translate-x-0.5">
        <ArrowUpRight size={15} />
      </span>
    </span>
  )

  if (item.href) {
    return (
      <Link href={item.href} onClick={onNavigate} className="block">
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onNavigate} className="block w-full text-left">
      <div
        onClick={() => {
          if (item.scrollToId) {
            document.getElementById(item.scrollToId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          onNavigate()
        }}
      >
        {content}
      </div>
    </button>
  )
}

export function VendorDashboardSidebar({
  vendor,
  open,
  counts,
  onClose,
  className = '',
}: {
  vendor: VendorDashboardVendor | null
  open: boolean
  counts: { active: number; pending: number; prep: number; ready: number }
  onClose: () => void
  className?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const activePath = pathname

  const shell = (
    <aside
      className={`flex h-full w-[18.75rem] flex-col border-r border-white/8 bg-black/70 backdrop-blur-xl ${className}`}
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.025) 22%, rgba(255,255,255,0.02) 100%), rgba(8,8,9,0.92)',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
        <Link href="/vendor-dashboard" className="flex items-center gap-3" onClick={onClose}>
          <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-[1.1rem] border border-white/10 bg-white/5">
            {vendor?.logo_url ? (
              <Image src={vendor.logo_url} alt="" fill className="object-cover" />
            ) : (
              <span className="text-sm font-semibold text-[#F5A623]">{initials(vendor?.shop_name)}</span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-semibold tracking-[-0.03em] text-white">LumeX</span>
            <span className="block truncate text-xs text-white/45">{vendor?.shop_name ?? 'Vendor workspace'}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => {
            if (open) onClose()
            else router.push('/vendor-dashboard')
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
      </div>

      <div className="px-5 pb-4">
        <div className="rounded-[1.35rem] border border-white/8 bg-[rgba(255,255,255,0.04)] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.32)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Store</p>
              <p className="mt-1 text-base font-semibold text-white">{vendor?.shop_name ?? 'Loading…'}</p>
            </div>
            <Badge color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}>
              {vendor?.status ?? 'OPEN'}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/38">Queue</p>
              <p className="mt-1 text-sm font-semibold text-white">{counts.active}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/38">Open</p>
              <p className="mt-1 text-sm font-semibold text-white">{formatClock(vendor?.opening_time ?? null)}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/38">Ready</p>
              <p className="mt-1 text-sm font-semibold text-white">{counts.ready}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4">
        <p className="px-2 pb-2 text-[11px] uppercase tracking-[0.2em] text-white/36">Quick actions</p>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/feed-v2/create" className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/14 hover:bg-white/[0.055]" onClick={onClose}>
            <p className="text-sm font-semibold text-white">Post</p>
            <p className="mt-0.5 text-[11px] text-white/40">Feed or story</p>
          </Link>
          <Link href="/vendor-dashboard/support" className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/14 hover:bg-white/[0.055]" onClick={onClose}>
            <p className="text-sm font-semibold text-white">Support</p>
            <p className="mt-0.5 text-[11px] text-white/40">Order issues</p>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-5">
        <div className="space-y-2">
          <p className="px-2 pb-1 text-[11px] uppercase tracking-[0.2em] text-white/36">Navigation</p>
          {ITEMS.map((item) => (
            <NavButton key={item.label} item={item} active={activePath === item.href} onNavigate={onClose} />
          ))}
        </div>
      </div>
    </aside>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 lg:hidden" style={{ display: open ? 'block' : 'none' }} onClick={onClose} aria-hidden="true" />
      <div
        className={`fixed inset-y-0 left-0 z-50 w-[18.75rem] transform transition-transform duration-300 lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {shell}
      </div>
      <div className="hidden lg:block lg:sticky lg:top-0 lg:h-dvh">{shell}</div>
    </>
  )
}
