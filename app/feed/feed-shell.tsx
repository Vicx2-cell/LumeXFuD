'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowRight, Bell, ChevronRight, Compass, Crown, Flame, Home, Plus, Search, Shield, Sparkles, Store, ShoppingBag, User, UtensilsCrossed, Users, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { Badge } from '@/components/ui/badge'
import { useFeatures } from '@/lib/use-features'
import type { FeedTabKey } from '@/lib/feed/types'

type FeedShellProps = {
  role: 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'
  roleLabel: string
  roleSubtitle: string
  profileName: string
  profileHandle: string
  profileBadge?: string | null
  campusName: string | null
  campusState?: string | null
  selectedTab: FeedTabKey
  trendingTopics: Array<{ label: string; count: number }>
  featuredVendors: Array<{ name: string; handle: string; count: number }>
  campusDeals: Array<{ title: string; vendor: string; priceLabel: string; badge: string }>
  children: ReactNode
}

type NavItem = {
  href?: string
  label: string
  icon: typeof Home
  disabled?: boolean
  exact?: boolean
  kind?: 'link' | 'button'
}

function initials(name: string) {
  const pieces = name.trim().split(/\s+/).filter(Boolean)
  if (pieces.length === 0) return 'LX'
  if (pieces.length === 1) return pieces[0].slice(0, 2).toUpperCase()
  return `${pieces[0][0] ?? 'L'}${pieces[1][0] ?? 'X'}`.toUpperCase()
}

function prettyTab(tab: FeedTabKey) {
  return tab.replaceAll('_', ' ')
}

function countLabel(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return `${count}`
}

function ShellCard({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[24px] border border-white/8 bg-white/[0.03] shadow-[0_16px_60px_rgba(0,0,0,0.20)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
        <h2 className="text-sm font-semibold text-white/92">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function NavRow({
  item,
  active,
  compact = false,
}: {
  item: NavItem
  active: boolean
  compact?: boolean
}) {
  const Icon = item.icon
  const base = 'group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]/60'
  const state = item.disabled
    ? 'cursor-not-allowed border border-white/6 bg-white/[0.02] text-white/28'
    : active
      ? 'border border-[#F5A623]/35 bg-[#F5A623]/12 text-[#ffd08a] shadow-[0_0_0_1px_rgba(245,166,35,0.08)]'
      : 'border border-transparent text-white/70 hover:border-white/8 hover:bg-white/[0.04] hover:text-white'

  if (item.kind === 'button') {
    return (
      <button type="button" disabled={item.disabled} className={`${base} ${state}`}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!compact && <span className="min-w-0 truncate">{item.label}</span>}
      </button>
    )
  }

  return (
    <Link
      href={item.href ?? '#'}
      aria-current={active ? 'page' : undefined}
      aria-disabled={item.disabled ? true : undefined}
      className={`${base} ${state} ${compact ? 'justify-center px-2' : ''}`}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {!compact && <span className="min-w-0 truncate">{item.label}</span>}
      {!compact && active && <span className="ml-auto h-2 w-2 rounded-full bg-[#F5A623]" aria-hidden="true" />}
    </Link>
  )
}

function BottomTab({
  href,
  label,
  icon: Icon,
  active,
  disabled = false,
  onClick,
}: {
  href?: string
  label: string
  icon: typeof Home
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  const state = disabled
    ? 'text-white/28'
    : active
      ? 'text-[#ffd08a]'
      : 'text-white/55'

  const content = (
    <>
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="text-[10px] font-semibold tracking-wide">{label}</span>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        aria-disabled={disabled ? true : undefined}
        className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-2 text-center transition ${state}`}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-2 text-center transition ${state}`}
    >
      {content}
    </button>
  )
}

export function FeedShell({
  role,
  roleLabel,
  roleSubtitle,
  profileName,
  profileHandle,
  profileBadge,
  campusName,
  campusState,
  selectedTab,
  trendingTopics,
  featuredVendors,
  campusDeals,
  children,
}: FeedShellProps) {
  const features = useFeatures()
  const pathname = usePathname()
  const router = useRouter()
  const activePath = pathname ?? '/feed'

  const showPremium = features.premium_enabled !== false
  const showBoost = features.post_boosts_enabled !== false
  const showVendorTools = role === 'vendor'
  const showRiderTools = role === 'rider'
  const showAdminTools = role === 'admin' || role === 'super_admin'

  const leftItems: NavItem[] = [
    { href: '/', label: 'Home', icon: Home, exact: true },
    { href: '/feed?tab=for_you', label: 'For you', icon: Sparkles },
    { href: '/feed?tab=trending', label: 'Trending', icon: Flame },
    { href: '/feed?tab=deals', label: 'Deals near you', icon: ShoppingBag },
    { href: '/vendor-dashboard/menu', label: 'Menu explorer', icon: UtensilsCrossed, disabled: role !== 'vendor' },
    { href: '/vendor-dashboard', label: 'Vendor dashboard', icon: Store, disabled: !showVendorTools },
    { href: '/rider', label: 'Rider dashboard', icon: Users, disabled: !showRiderTools },
    { href: '/super-admin', label: 'Super Admin', icon: Shield, disabled: !showAdminTools },
  ]

  return (
    <div className="lx-page min-h-screen pb-24">
      <div className="sticky top-0 z-50 border-b border-white/8 bg-[rgba(10,10,11,0.88)] px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo size={34} rounded={12} />
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-white">LumeX Feed</p>
              <p className="truncate text-[11px] text-white/48">
                {roleLabel} · {campusName ?? 'Campus feed'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/78" aria-label="Search LumeX">
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/78" aria-label="Notifications unavailable">
              <Bell className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1500px] gap-4 px-3 py-4 lg:grid-cols-[96px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_320px] lg:px-4 xl:px-5">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] lg:flex">
          <div className="flex h-full w-full flex-col rounded-[28px] border border-white/8 bg-[rgba(8,8,10,0.74)] px-3 py-4 shadow-[0_18px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl xl:px-4">
            <div className="flex items-center gap-3 px-1">
              <BrandLogo size={36} rounded={12} />
              <div className="hidden min-w-0 xl:block">
                <p className="truncate text-lg font-black text-white">LumeX</p>
                <p className="truncate text-xs text-white/45">{roleLabel}</p>
                <p className="truncate text-[11px] text-white/35">{roleSubtitle}</p>
              </div>
            </div>

            <div className="mt-6 space-y-1.5">
              {leftItems.map((item) => (
                <NavRow
                  key={item.label}
                  item={item}
                  active={Boolean(
                    item.href && (
                      item.exact
                        ? activePath === item.href
                        : activePath.startsWith(item.href.split('?')[0] ?? item.href)
                    ),
                  )}
                />
              ))}
            </div>

            <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F5A623] to-[#f97316] text-sm font-black text-black">
                  {initials(profileName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{profileName}</p>
                  <p className="truncate text-xs text-white/45">@{profileHandle}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge color="rgba(255,255,255,0.35)">{role}</Badge>
                    {profileBadge && <Badge color="var(--lx-amber)">{profileBadge}</Badge>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/feed?tab=for_you#composer')}
                  className="rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/8"
                  aria-label="Open composer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-white/6 bg-black/20 px-3 py-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Campus</p>
                  <p className="truncate text-sm text-white">{campusName ?? 'Set your campus'}</p>
                </div>
                <Badge color="var(--lx-green)">{campusState ?? 'Local'}</Badge>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/8 bg-gradient-to-br from-[#1a1308] via-[#18110a] to-[#0d0b0b] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />
                    <p className="text-sm font-semibold text-white">Go Premium</p>
                  </div>
                  <p className="mt-2 text-sm text-white/60">Unlock more reach, analytics, and creator tools.</p>
                </div>
              </div>
              <button
                type="button"
                disabled={!showPremium}
                onClick={() => router.push('/premium')}
                className="mt-4 w-full rounded-2xl bg-[#F5A623] px-3 py-3 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                {showPremium ? 'Upgrade now' : 'Premium unavailable'}
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          {children}
        </main>

        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] xl:block">
          <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
            <ShellCard
              title="Search LumeX"
              action={<Search className="h-4 w-4 text-white/45" aria-hidden="true" />}
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-black/25 px-4 py-3 text-left text-sm text-white/50 transition hover:border-white/12 hover:bg-white/[0.04]"
              >
                <Search className="h-4 w-4 text-white/35" aria-hidden="true" />
                <span>Search vendors, posts, deals, creators</span>
              </button>
              <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Campus context</p>
                  <p className="truncate text-sm text-white">{campusName ?? 'ABSU campus'}</p>
                </div>
                <MapPin className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />
              </div>
            </ShellCard>

            <ShellCard
              title="What’s happening"
              action={<Badge color="var(--lx-amber)">{prettyTab(selectedTab)}</Badge>}
            >
              <div className="space-y-3">
                {trendingTopics.length > 0 ? trendingTopics.slice(0, 4).map((topic) => (
                  <div key={topic.label} className="flex items-start justify-between gap-3 rounded-2xl border border-white/6 bg-black/20 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{topic.label}</p>
                      <p className="text-xs text-white/45">{countLabel(topic.count)} posts</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-white/35" aria-hidden="true" />
                  </div>
                )) : (
                  <div className="rounded-2xl border border-white/6 bg-black/20 px-3 py-4 text-sm text-white/55">
                    Trending topics will appear as posts arrive.
                  </div>
                )}
              </div>
            </ShellCard>

            {showBoost && (
              <ShellCard title="Boost your post" action={<Sparkles className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />}>
                <div className="rounded-[22px] border border-white/8 bg-gradient-to-br from-[#2a1322] via-[#171018] to-[#111112] p-4">
                  <p className="text-sm font-semibold text-white">Reach more students on campus.</p>
                  <p className="mt-1 text-sm text-white/58">Promote a post when you have a campaign worth amplifying.</p>
                  <button type="button" className="mt-4 rounded-2xl bg-[linear-gradient(135deg,#ff4d7d,#ff6b57)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
                    Boost now
                  </button>
                </div>
              </ShellCard>
            )}

            <ShellCard title="Top vendors" action={<Badge color="rgba(255,255,255,0.35)">Live</Badge>}>
              <div className="space-y-3">
                {featuredVendors.length > 0 ? featuredVendors.slice(0, 4).map((vendor, index) => (
                  <div key={`${vendor.handle}-${index}`} className="flex items-center gap-3 rounded-2xl border border-white/6 bg-black/20 px-3 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-xs font-semibold text-white">
                      {initials(vendor.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{vendor.name}</p>
                      <p className="truncate text-xs text-white/45">@{vendor.handle}</p>
                    </div>
                    <Badge color="var(--lx-green)">{countLabel(vendor.count)}</Badge>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-white/6 bg-black/20 px-3 py-4 text-sm text-white/55">
                    Vendor suggestions will appear here when there is enough live content.
                  </div>
                )}
              </div>
            </ShellCard>

            <ShellCard title="Campus deals" action={<Badge color="var(--lx-green)">Today</Badge>}>
              <div className="space-y-3">
                {campusDeals.length > 0 ? campusDeals.slice(0, 3).map((deal, index) => (
                  <div key={`${deal.title}-${index}`} className="rounded-2xl border border-white/6 bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{deal.title}</p>
                        <p className="truncate text-xs text-white/45">{deal.vendor}</p>
                      </div>
                      <Badge color="var(--lx-amber)">{deal.badge}</Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-[#ffd08a]">{deal.priceLabel}</p>
                      <ChevronRight className="h-4 w-4 text-white/35" aria-hidden="true" />
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-white/6 bg-black/20 px-3 py-4 text-sm text-white/55">
                    Active deals will surface here from live posts and promotions.
                  </div>
                )}
              </div>
            </ShellCard>

            {showPremium && (
              <ShellCard title="Premium" action={<Crown className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />}>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />
                    <p className="text-sm font-semibold text-white">Upgrade for more reach</p>
                  </div>
                  <p className="mt-2 text-sm text-white/58">Unlock Premium features once billing is fully enabled.</p>
                  <button
                    type="button"
                    onClick={() => router.push('/premium')}
                    className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.04]"
                  >
                    View plan
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </ShellCard>
            )}
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-3 bottom-3 z-50 lg:hidden">
        <div
          className="mx-auto flex max-w-md items-center gap-2 rounded-[24px] border border-white/8 bg-[rgba(10,10,11,0.94)] px-2 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        >
          <BottomTab href="/" label="Home" icon={Home} active={activePath === '/'} />
          <BottomTab href="/feed?tab=trending" label="Explore" icon={Compass} active={activePath.startsWith('/feed')} />
          <BottomTab href="/feed#composer" label="Create" icon={Plus} active={false} />
          <BottomTab label="Alerts" icon={Bell} disabled />
          <BottomTab href="/profile" label="Profile" icon={User} active={activePath.startsWith('/profile')} />
        </div>
      </div>
    </div>
  )
}
