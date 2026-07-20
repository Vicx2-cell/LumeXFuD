'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CircleDollarSign,
  Grid2x2,
  LifeBuoy,
  ListOrdered,
  Menu,
  Settings2,
  Star,
  Store,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { initials, type VendorDashboardVendor } from './helpers'

type SidebarItem = {
  label: string
  href: string
  icon: typeof Grid2x2
}

const PRIMARY_ITEMS: SidebarItem[] = [
  { label: 'Overview', href: '/vendor-dashboard', icon: Grid2x2 },
  { label: 'Orders', href: '/vendor-dashboard/orders', icon: ListOrdered },
  { label: 'Menu', href: '/vendor-dashboard/menu', icon: UtensilsCrossed },
  { label: 'Store', href: '/vendor-dashboard/store', icon: Store },
  { label: 'Earnings', href: '/vendor-dashboard/earnings', icon: CircleDollarSign },
]

const SECONDARY_ITEMS: SidebarItem[] = [
  { label: 'Reviews', href: '/vendor-dashboard/reviews', icon: Star },
  { label: 'Support', href: '/vendor-dashboard/support', icon: LifeBuoy },
]

function isActive(pathname: string, href: string) {
  return href === '/vendor-dashboard' ? pathname === href : pathname.startsWith(href)
}

function NavItem({ item, pathname, pending, onNavigate }: { item: SidebarItem; pathname: string; pending: number; onNavigate: () => void }) {
  const Icon = item.icon
  const active = isActive(pathname, item.href)
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 transition ${active ? 'border-[#F5A623]/30 bg-[#F5A623]/10 text-white' : 'border-transparent text-white/58 hover:border-white/8 hover:bg-white/[0.04] hover:text-white'}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-[#F5A623]/15 text-[#F5A623]' : 'bg-white/[0.035] text-white/60'}`}>
        <Icon size={17} strokeWidth={1.9} />
      </span>
      <span className="flex-1 text-sm font-semibold">{item.label}</span>
      {item.label === 'Orders' && pending > 0 && (
        <span className="min-w-6 rounded-full bg-[#F5A623] px-2 py-0.5 text-center text-[11px] font-bold text-black">{pending}</span>
      )}
    </Link>
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

  const shell = (
    <aside className={`flex h-full w-[17rem] flex-col border-r border-white/8 bg-[#0b0b0d]/95 backdrop-blur-xl ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <Link href="/vendor-dashboard" className="flex min-w-0 items-center gap-3" onClick={onClose}>
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            {vendor?.logo_url ? <Image src={vendor.logo_url} alt="" fill className="object-cover" /> : <span className="text-sm font-semibold text-[#F5A623]">{initials(vendor?.shop_name)}</span>}
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold tracking-[-0.02em] text-white">LumeX Vendor</span>
            <span className="block truncate text-xs text-white/42">{vendor?.shop_name ?? 'Loading…'}</span>
          </span>
        </Link>
        <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 lg:hidden" aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Kitchen</p>
              <p className="mt-1 text-sm font-semibold text-white">{counts.active > 0 ? `${counts.active} active` : 'All caught up'}</p>
            </div>
            <Badge color={vendor?.status === 'OPEN' ? 'var(--lx-green)' : vendor?.status === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}>{vendor?.status ?? 'OPEN'}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-white/8 rounded-xl bg-black/20 py-2 text-center">
            <MiniCount label="New" value={counts.pending} />
            <MiniCount label="Prep" value={counts.prep} />
            <MiniCount label="Ready" value={counts.ready} />
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Vendor dashboard">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Work</p>
        <div className="space-y-1">
          {PRIMARY_ITEMS.map((item) => <NavItem key={item.href} item={item} pathname={pathname} pending={counts.pending} onNavigate={onClose} />)}
        </div>
        <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">More</p>
        <div className="space-y-1">
          {SECONDARY_ITEMS.map((item) => <NavItem key={item.href} item={item} pathname={pathname} pending={counts.pending} onNavigate={onClose} />)}
        </div>
      </nav>

      <div className="border-t border-white/8 p-4">
        <Link href="/vendor-dashboard/store" onClick={onClose} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white/48 transition hover:bg-white/[0.04] hover:text-white">
          <Settings2 size={17} /> Store settings
        </Link>
      </div>
    </aside>
  )

  return (
    <>
      {open && <button type="button" className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm lg:hidden" onClick={onClose} aria-label="Close navigation overlay" />}
      <div className={`fixed inset-y-0 left-0 z-50 w-[min(88vw,17rem)] transform transition-transform duration-300 lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}>{shell}</div>
      <div className="sticky top-0 hidden h-dvh lg:block">{shell}</div>
    </>
  )
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return <div><p className="text-sm font-semibold text-white">{value}</p><p className="text-[9px] uppercase tracking-wide text-white/30">{label}</p></div>
}

export function VendorMobileBottomNav({ pending, onMore }: { pending: number; onMore: () => void }) {
  const pathname = usePathname()
  const items = PRIMARY_ITEMS.filter((item) => item.label !== 'Store')

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#09090b]/95 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-2xl lg:hidden" aria-label="Vendor quick navigation">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon
          const active = isActive(pathname, item.href)
          return (
            <Link key={item.href} href={item.href} className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${active ? 'text-[#F5A623]' : 'text-white/42'}`}>
              <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
              <span>{item.label}</span>
              {item.label === 'Orders' && pending > 0 && <span className="absolute right-[calc(50%-19px)] top-1 min-w-4 rounded-full bg-[#F5A623] px-1 text-center text-[9px] font-bold leading-4 text-black">{pending}</span>}
            </Link>
          )
        })}
        <button type="button" onClick={onMore} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold text-white/42" aria-label="Open more vendor tools">
          <Menu size={19} />
          <span>More</span>
        </button>
      </div>
    </nav>
  )
}
