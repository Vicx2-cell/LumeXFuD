'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCart } from './cart-context'
import { useFeatures } from '@/lib/use-features'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/feed-v2', label: 'Feed', icon: FeedIcon, feature: 'feed_enabled' },
  { href: '/orders', label: 'Orders', icon: OrdersIcon },
  { href: '/cart', label: 'Cart', icon: CartIcon, showBadge: true },
  { href: '/leaderboard', label: 'Ranks', icon: TrophyIcon, feature: 'leaderboard' },
  { href: '/profile', label: 'Profile', icon: ProfileIcon },
]

export function BottomNav() {
  const pathname = usePathname()
  const { totalItems } = useCart()
  const features = useFeatures()

  // Hide any nav item whose feature flag is turned off.
  const items = NAV_ITEMS.filter((i) => !i.feature || features[i.feature] !== false)

  return (
    // Full-width positioner is click-transparent so the empty desktop gutters never
    // intercept taps; only the bar itself is interactive. The bar is bound to the
    // app column (max-w-lg) — flush to the screen edge on mobile, a centered
    // floating pill on desktop (sm+) so it tracks the centered content instead of
    // stretching across a wide screen with its items bunched in the middle.
    <nav
      className="fixed bottom-0 inset-x-0 z-50 pointer-events-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="pointer-events-auto mx-auto max-w-lg border-t border-white/8 sm:border sm:border-white/10 sm:rounded-2xl sm:mb-3 sm:shadow-[0_10px_40px_rgba(0,0,0,0.55)]"
        style={{
          background: 'var(--lx-nav-bg)',
          backdropFilter: 'blur(20px)',
        }}
      >
      <div className="flex h-16 items-center px-1 sm:px-2">
        {items.map(({ href, label, icon: Icon, showBadge }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 active:scale-90 transition-transform"
              style={{ color: active ? 'var(--color-amber)' : 'var(--lx-text-muted)' }}
            >
              {/* Active indicator line riding the top edge of the bar */}
              <span
                className="absolute -top-px rounded-full"
                style={{
                  height: 2,
                  width: active ? 22 : 0,
                  background: '#F5A623',
                  boxShadow: active ? '0 0 10px rgba(245,166,35,0.85)' : 'none',
                  transition: 'width 0.3s var(--spring-snappy)',
                }}
                aria-hidden="true"
              />
              {/* Icon sits in a pill that lights amber + lifts when active */}
              <div
                className="relative flex items-center justify-center"
                style={{
                  width: 44,
                  height: 30,
                  borderRadius: 12,
                  background: active ? 'rgba(245,166,35,0.14)' : 'transparent',
                  transform: active ? 'translateY(-1px)' : 'none',
                  transition: 'background 0.3s ease, transform 0.3s var(--spring-snappy)',
                }}
              >
                <Icon active={active} />
                {showBadge && totalItems > 0 && (
                  <span
                    className="absolute -top-1.5 -right-0.5 text-[10px] font-bold rounded-full flex items-center justify-center"
                    style={{
                      background: '#F5A623',
                      color: '#000',
                      minWidth: 16,
                      height: 16,
                      padding: '0 3px',
                      boxShadow: '0 0 0 2px var(--lx-nav-bg)',
                    }}
                  >
                    {totalItems > 99 ? '99+' : totalItems}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-semibold tracking-wide"
                style={{ transition: 'color 0.3s ease' }}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
      </div>
    </nav>
  )
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9,22 9,12 15,12 15,22" />
    </svg>
  )
}

function FeedIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M8 9h8" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  )
}

function OrdersIcon({ active: _active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  )
}

function CartIcon({ active: _active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}

function TrophyIcon({ active: _active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function ProfileIcon({ active: _active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
