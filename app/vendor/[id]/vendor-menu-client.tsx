'use client'

import { useState, useMemo, useEffect } from 'react'
import Image from 'next/image'
import { FOOD_BLUR } from '@/lib/blur'
import { useRouter } from 'next/navigation'
import { useCart, cartLineKey, type CartItem, type CartAddon } from '@/components/cart-context'
import { formatPrice } from '@/lib/money'
import { vendorTrustBadges } from '@/lib/vendor-trust'
import { VerifiedBadge } from '@/components/verified-badge'
import { Badge } from '@/components/ui/badge'
import { Pill } from '@/components/ui/pill'
import type { VendorInfo, MenuItem, VendorReview } from './page'

const CATEGORIES = ['All', 'Rice', 'Protein', 'Drinks', 'Snacks', 'Other']

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })
}

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" fill={value >= n ? '#F5A623' : 'none'} stroke={value >= n ? '#F5A623' : 'rgba(255,255,255,0.25)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  )
}

export function VendorMenuClient({ vendor, menu, reviews = [], loggedOut = false }: { vendor: VendorInfo; menu: MenuItem[]; reviews?: VendorReview[]; loggedOut?: boolean }) {
  const router = useRouter()
  const { cart, addItem, clearCart, totalItems, subtotal } = useCart()
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [showConflict, setShowConflict] = useState(false)
  const [pendingItem, setPendingItem] = useState<CartItem | null>(null)

  // Add-on selection sheet
  const [selecting, setSelecting] = useState<MenuItem | null>(null)
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([])

  const isPaused = vendor.paused_until && new Date(vendor.paused_until) > new Date()
  const isClosed = vendor.status === 'CLOSED' || isPaused

  // Remember this vendor for a logged-out visitor (arrived via the share link) so
  // that after ANY login/signup they're returned here — even if they reach auth
  // by a route that didn't carry a ?next=.
  useEffect(() => {
    if (loggedOut) {
      try { sessionStorage.setItem('lx_return_vendor', `/vendor/${vendor.id}`) } catch { /* ignore */ }
    }
  }, [loggedOut, vendor.id])

  const vendorNext = encodeURIComponent(`/vendor/${vendor.id}`)

  const filtered = useMemo(() => {
    return menu.filter((item) => {
      const matchCat = activeCategory === 'All' || item.category.toUpperCase() === activeCategory.toUpperCase()
      const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }, [menu, activeCategory, search])

  function buildCartItem(item: MenuItem, addons: CartAddon[]): CartItem {
    return {
      id: cartLineKey(item.id, addons),
      menu_item_id: item.id,
      name: item.name,
      price_kobo: item.price_kobo,
      quantity: 1,
      // Per-dish time, falling back to the vendor's base — so the cart ETA works.
      prep_time_minutes: item.prep_time_minutes ?? vendor.prep_time_minutes,
      addons,
    }
  }

  function doAdd(cartItem: CartItem) {
    const success = addItem(vendor.id, vendor.shop_name, cartItem)
    if (!success) {
      setPendingItem(cartItem)
      setShowConflict(true)
    }
  }

  function handleAdd(item: MenuItem) {
    if (isClosed) return
    if (item.addons.length > 0) {
      setSelecting(item)
      setSelectedAddonIds([])
      return
    }
    doAdd(buildCartItem(item, []))
  }

  function confirmAddons() {
    if (!selecting) return
    const chosen = selecting.addons.filter((a) => selectedAddonIds.includes(a.id))
    doAdd(buildCartItem(selecting, chosen.map((a) => ({ id: a.id, name: a.name, price_kobo: a.price_kobo }))))
    setSelecting(null)
    setSelectedAddonIds([])
  }

  function handleConflictConfirm() {
    if (!pendingItem) return
    clearCart()
    addItem(vendor.id, vendor.shop_name, pendingItem)
    setShowConflict(false)
    setPendingItem(null)
  }

  // Total quantity of this menu item across all its add-on variants.
  const qtyForItem = (menuItemId: string) =>
    cart.items.filter((i) => i.menu_item_id === menuItemId).reduce((s, i) => s + i.quantity, 0)

  const selectingTotal = selecting
    ? selecting.price_kobo + selecting.addons.filter((a) => selectedAddonIds.includes(a.id)).reduce((s, a) => s + a.price_kobo, 0)
    : 0

  return (
    <>
      {/* Conflict dialog */}
      {showConflict && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lx-scrim" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="lx-sheet glass-thick w-full max-w-lg p-6 space-y-4" style={{ borderRadius: '28px 28px 0 0' }}>
            <h3 className="font-semibold text-lg">Start new cart?</h3>
            <p className="text-sm text-white/65">
              You have items from <strong>{cart.vendor_name}</strong> in your cart. Starting a new cart will remove them.
            </p>
            <button onClick={handleConflictConfirm} className="lx-btn-amber w-full py-3.5">
              Yes, start new cart
            </button>
            <button onClick={() => { setShowConflict(false); setPendingItem(null) }} className="lx-btn-secondary w-full py-3 text-sm">
              Keep existing cart
            </button>
          </div>
        </div>
      )}

      {/* Add-on selection sheet */}
      {selecting && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lx-scrim" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSelecting(null)}>
          <div className="lx-sheet glass-thick w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-y-auto" style={{ borderRadius: '28px 28px 0 0' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">{selecting.name}</h3>
                <p className="lx-amber text-sm">{formatPrice(selecting.price_kobo)}</p>
              </div>
              <button onClick={() => setSelecting(null)} className="text-white/40 text-sm">Close</button>
            </div>

            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Add extras (optional)</p>
            <div className="space-y-2">
              {selecting.addons.map((a) => {
                const checked = selectedAddonIds.includes(a.id)
                return (
                  <button key={a.id}
                    onClick={() => setSelectedAddonIds((prev) => checked ? prev.filter((x) => x !== a.id) : [...prev, a.id])}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                    style={{ background: checked ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${checked ? '#F5A623' : 'rgba(255,255,255,0.07)'}` }}>
                    <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: checked ? '#F5A623' : 'transparent', border: `2px solid ${checked ? '#F5A623' : 'rgba(255,255,255,0.3)'}` }}>
                      {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <span className="flex-1 text-sm">{a.name}</span>
                    <span className="text-sm text-white/60">+{formatPrice(a.price_kobo)}</span>
                  </button>
                )
              })}
            </div>

            {/* Sticky footer so the confirm button is always reachable, even with
                a long add-on list on a small phone. */}
            <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-5" style={{ background: 'linear-gradient(to top, var(--lx-surface-solid) 72%, transparent)' }}>
              <button onClick={confirmAddons} className="lx-btn-amber w-full rounded-2xl py-4">
                Add to cart · {formatPrice(selectingTotal)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cover hero — the vendor's cover photo (or a branded gradient) with the
          logo overlaid, so the storefront never opens on a blank header. */}
      {(vendor.shop_photo_url || vendor.logo_url) && (
        <div className="relative w-full" style={{ aspectRatio: '16 / 7' }}>
          {vendor.shop_photo_url ? (
            <Image src={vendor.shop_photo_url} alt="" fill priority className="object-cover" sizes="100vw" placeholder="blur" blurDataURL={FOOD_BLUR} />
          ) : (
            <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, rgba(245,166,35,0.30), rgba(99,102,241,0.18))' }} />
          )}
          <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(to top, #0A0A0B 2%, rgba(10,10,11,0.25) 55%, transparent)' }} />
          {vendor.logo_url && (
            <div className="absolute bottom-3 left-4 w-16 h-16 rounded-2xl overflow-hidden" style={{ border: '2px solid rgba(255,255,255,0.25)', boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
              <Image src={vendor.logo_url} alt="" fill className="object-cover" sizes="64px" />
            </div>
          )}
        </div>
      )}

      {/* Sticky header */}
      <div className="sticky top-0 z-40 glass-thin" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-full transition-transform active:scale-90" style={{ background: 'rgba(255,255,255,0.08)' }} aria-label="Go back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-base truncate">{vendor.shop_name}</h1>
              {vendor.kyc_verified && <VerifiedBadge kind="vendor" />}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge color={vendor.status === 'OPEN' ? 'var(--lx-green)' : vendor.status === 'BUSY' ? 'var(--color-amber)' : 'var(--lx-red)'}>
                {isPaused ? 'Paused' : vendor.status}
              </Badge>
              <span className="text-xs text-white/40">{vendor.prep_time_minutes}–{vendor.prep_time_minutes + 10} min</span>
              {vendor.opening_time && vendor.closing_time && (
                <span className="text-xs text-white/40">🕒 {vendor.opening_time}–{vendor.closing_time}</span>
              )}
              {vendor.total_ratings >= 5 && <span className="lx-amber text-xs">★ {vendor.avg_rating.toFixed(1)}</span>}
              {vendorTrustBadges(vendor).map((b) => (
                <span key={b.label} className="lx-card-amber lx-amber text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                  <span aria-hidden="true">{b.emoji}</span>{b.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {isPaused && <div className="px-4 pb-2 text-center"><span className="text-xs text-yellow-400">Temporarily paused — back soon</span></div>}
        {isClosed && vendor.status === 'CLOSED' && <div className="px-4 pb-2 text-center"><span className="text-xs text-red-400">Closed{vendor.opening_time ? ` — Opens at ${vendor.opening_time}` : ''}</span></div>}

        {/* Logged-out visitors (e.g. arrived via the vendor's share link): one tap
            to create an account, and they come right back to this page. */}
        {loggedOut && (
          <div className="lx-card-amber mx-4 mb-2 rounded-xl px-4 py-3">
            <p className="text-sm text-white/85 mb-2">Order to your hostel — you’ll come right back to this page.</p>
            <div className="flex gap-2">
              <a href={`/auth/register?next=${vendorNext}`} className="lx-btn-amber flex-1 text-center py-2 rounded-lg text-sm">Create account</a>
              <a href={`/auth?next=${vendorNext}`} className="flex-1 text-center py-2 rounded-lg text-sm font-semibold" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>Log in</a>
            </div>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
          {CATEGORIES.map((cat) => (
            <Pill key={cat} active={activeCategory === cat} onClick={() => setActiveCategory(cat)} className="shrink-0 px-3 py-1.5 text-xs">
              {cat}
            </Pill>
          ))}
        </div>
      </div>

      {menu.length > 10 && (
        <div className="max-w-lg mx-auto px-4 py-3">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu..." aria-label="Search menu"
            className="lx-field w-full px-4 py-2.5 text-sm outline-none" />
        </div>
      )}

      {/* Menu items */}
      <div className="max-w-lg mx-auto px-4 py-3 space-y-3 lx-stagger">
        {filtered.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="lx-icon-badge w-16 h-16 rounded-2xl mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
            </div>
            <p className="font-medium text-white/80">Nothing on this shelf yet</p>
            <p className="text-sm text-white/45 mt-1">{search ? `No results for “${search}”.` : 'Try another category.'}</p>
          </div>
        ) : (
          filtered.map((item) => {
            const qty = qtyForItem(item.id)
            const soldOut = !item.is_available || (item.daily_limit !== null && item.sold_today >= item.daily_limit)
            return (
              <div key={item.id} className="glass-thin flex gap-3 p-3 transition-transform hover:-translate-y-0.5" style={{ opacity: soldOut ? 0.5 : 1 }}>
                <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-white/5">
                  {item.image_url
                    ? <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="80px" placeholder="blur" blurDataURL={FOOD_BLUR} />
                    : <div className="w-full h-full flex items-center justify-center text-white/15"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm leading-tight">{item.name}</h3>
                  {item.description && <p className="text-xs text-white/40 mt-0.5 line-clamp-2">{item.description}</p>}
                  <p className="lx-amber font-semibold text-sm mt-1">{formatPrice(item.price_kobo)}</p>
                  {item.prep_time_minutes != null && <p className="text-xs text-white/40 mt-0.5">⏱ {item.prep_time_minutes} min</p>}
                  {item.addons.length > 0 && <p className="text-xs text-white/30 mt-0.5">{item.addons.length} add-on{item.addons.length === 1 ? '' : 's'} available</p>}
                  {soldOut && <p className="text-xs text-red-400 mt-1">Sold out</p>}
                </div>
                <div className="shrink-0 flex flex-col items-center justify-center">
                  <button onClick={() => handleAdd(item)} disabled={isClosed || soldOut}
                    className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl disabled:opacity-30 relative transition-transform active:scale-90 hover:scale-105"
                    style={{ background: '#F5A623', color: '#000', boxShadow: '0 0 16px rgba(245,166,35,0.35)', minWidth: 48, minHeight: 48 }} aria-label={`Add ${item.name}`}>
                    +
                    {qty > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold" style={{ background: '#000', color: '#F5A623' }}>{qty}</span>
                    )}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Reviews */}
      <div className="max-w-lg mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Reviews</h2>
          {vendor.total_ratings > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Stars value={Math.round(vendor.avg_rating)} />
              <span className="text-white/70 tabular-nums">{vendor.avg_rating.toFixed(1)}</span>
              <span className="text-white/40">({vendor.total_ratings})</span>
            </div>
          )}
        </div>

        {reviews.length === 0 ? (
          <div className="glass-thin p-6 text-center">
            <p className="text-sm text-white/55">No reviews yet</p>
            <p className="text-xs text-white/35 mt-1">Be the first to review after your order.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {reviews.map((r) => (
              <div key={r.id} className="glass rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="lx-icon-badge w-9 h-9 rounded-full shrink-0" aria-hidden="true">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate text-white/80">Anonymous</span>
                      <span className="text-[11px] text-white/35 shrink-0">{relativeDay(r.created_at)}</span>
                    </div>
                    <div className="mt-0.5"><Stars value={r.stars} /></div>
                  </div>
                </div>
                {r.review && <p className="text-sm text-white/80 mt-3 leading-relaxed">{r.review}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky cart bar — clears the bottom nav + the device safe-area inset */}
      {totalItems > 0 && cart.vendor_id === vendor.id && (
        <div className="fixed left-0 right-0 z-40 px-4 lx-enter" style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
          <div className="max-w-lg mx-auto">
            <button onClick={() => router.push('/cart')} className="lx-btn-amber w-full py-4 flex items-center justify-between px-5" style={{ borderRadius: 16 }}>
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(0,0,0,0.15)' }}>{totalItems}</span>
              <span>View Cart</span>
              <span>{formatPrice(subtotal)}</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
