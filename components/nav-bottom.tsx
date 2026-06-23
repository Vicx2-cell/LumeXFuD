'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCart } from './cart-context'
import { useFeatures } from '@/lib/use-features'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: HomeIcon },
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
          background: 'rgba(10,10,11,0.95)',
          backdropFilter: 'blur(20px)',
        }}
      >
      <div className="flex items-center justify-around h-16 px-2">
        {items.map(({ href, label, icon: Icon, showBadge }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1 min-w-[44px] min-h-[44px] justify-center relative"
            >
              <div className="relative">
                <Icon active={active} />
                {showBadge && totalItems > 0 && (
                  <span
                    className="absolute -top-1 -right-1 text-[10px] font-bold rounded-full flex items-center justify-center"
                    style={{
                      background: '#F5A623',
                      color: '#000',
                      minWidth: 16,
                      height: 16,
                      padding: '0 3px',
                    }}
                  >
                    {totalItems > 9 ? '9+' : totalItems}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-medium"
                style={{ color: active ? '#F5A623' : 'rgba(255,255,255,0.5)' }}
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? '#F5A623' : 'none'}
      stroke={active ? '#F5A623' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9,22 9,12 15,12 15,22" />
    </svg>
  )
}

function OrdersIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={active ? '#F5A623' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  )
}

function CartIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={active ? '#F5A623' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}

function TrophyIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={active ? '#F5A623' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={active ? '#F5A623' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
