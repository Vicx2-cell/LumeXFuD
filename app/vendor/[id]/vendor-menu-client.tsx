'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart-context'
import { formatPrice } from '@/lib/money'
import type { VendorInfo, MenuItem } from './page'

const CATEGORIES = ['All', 'Rice', 'Protein', 'Drinks', 'Snacks', 'Other']

export function VendorMenuClient({ vendor, menu }: { vendor: VendorInfo; menu: MenuItem[] }) {
  const router = useRouter()
  const { cart, addItem, setQuantity, clearCart, totalItems, subtotal } = useCart()
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [showConflict, setShowConflict] = useState(false)
  const [pendingAdd, setPendingAdd] = useState<MenuItem | null>(null)

  const isPaused = vendor.paused_until && new Date(vendor.paused_until) > new Date()
  const isClosed = vendor.status === 'CLOSED' || isPaused

  const filtered = useMemo(() => {
    return menu.filter((item) => {
      const matchCat = activeCategory === 'All' || item.category.toUpperCase() === activeCategory.toUpperCase()
      const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }, [menu, activeCategory, search])

  function handleAdd(item: MenuItem) {
    if (isClosed) return
    const cartItem = {
      id: item.id,
      name: item.name,
      price_kobo: item.price_kobo,
      quantity: 1,
    }
    const success = addItem(vendor.id, vendor.shop_name, cartItem)
    if (!success) {
      setPendingAdd(item)
      setShowConflict(true)
    }
  }

  function handleConflictConfirm() {
    if (!pendingAdd) return
    clearCart()
    addItem(vendor.id, vendor.shop_name, {
      id: pendingAdd.id,
      name: pendingAdd.name,
      price_kobo: pendingAdd.price_kobo,
      quantity: 1,
    })
    setShowConflict(false)
    setPendingAdd(null)
  }

  const getItemQty = (itemId: string) => {
    return cart.items.find((i) => i.id === itemId)?.quantity ?? 0
  }

  return (
    <>
      {/* Conflict dialog */}
      {showConflict && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-lg rounded-t-3xl p-6 space-y-4" style={{ background: '#111113' }}>
            <h3 className="font-semibold text-lg">Start new cart?</h3>
            <p className="text-sm text-white/60">
              You have items from <strong>{cart.vendor_name}</strong> in your cart. Starting a new cart will remove them.
            </p>
            <button
              onClick={handleConflictConfirm}
              className="w-full rounded-xl py-3.5 font-semibold"
              style={{ background: '#F5A623', color: '#000' }}
            >
              Yes, start new cart
            </button>
            <button
              onClick={() => { setShowConflict(false); setPendingAdd(null) }}
              className="w-full py-3 text-sm text-white/50"
            >
              Keep existing cart
            </button>
          </div>
        </div>
      )}

      {/* Sticky header */}
      <div className="sticky top-0 z-40 border-b border-white/8"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-base truncate">{vendor.shop_name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: vendor.status === 'OPEN' ? 'rgba(34,197,94,0.15)' : vendor.status === 'BUSY' ? 'rgba(245,166,35,0.15)' : 'rgba(239,68,68,0.15)',
                  color: vendor.status === 'OPEN' ? '#22c55e' : vendor.status === 'BUSY' ? '#F5A623' : '#ef4444',
                }}
              >
                {isPaused ? 'Paused' : vendor.status}
              </span>
              <span className="text-xs text-white/40">{vendor.prep_time_minutes}–{vendor.prep_time_minutes + 10} min</span>
              {vendor.total_ratings >= 5 && (
                <span className="text-xs text-[#F5A623]">★ {vendor.avg_rating.toFixed(1)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Pause banner */}
        {isPaused && (
          <div className="px-4 pb-2 text-center">
            <span className="text-xs text-yellow-400">Temporarily paused — back soon</span>
          </div>
        )}

        {isClosed && vendor.status === 'CLOSED' && (
          <div className="px-4 pb-2 text-center">
            <span className="text-xs text-red-400">Closed — Opens at 7am</span>
          </div>
        )}

        {/* Category tabs */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: activeCategory === cat ? '#F5A623' : 'rgba(255,255,255,0.07)',
                color: activeCategory === cat ? '#000' : 'rgba(255,255,255,0.6)',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Search if many items */}
      {menu.length > 10 && (
        <div className="max-w-lg mx-auto px-4 py-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu..."
            className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
          />
        </div>
      )}

      {/* Menu items */}
      <div className="max-w-lg mx-auto px-4 py-3 space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-white/30">No items in this category</div>
        ) : (
          filtered.map((item) => {
            const qty = getItemQty(item.id)
            const soldOut = !item.is_available || (item.daily_limit !== null && item.sold_today >= item.daily_limit)

            return (
              <div
                key={item.id}
                className="flex gap-3 rounded-2xl p-3"
                style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)', opacity: soldOut ? 0.5 : 1 }}
              >
                {/* Image */}
                <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-white/5">
                  {item.image_url ? (
                    <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="80px" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl opacity-20">🍽️</div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm leading-tight">{item.name}</h3>
                  {item.description && (
                    <p className="text-xs text-white/40 mt-0.5 line-clamp-2">{item.description}</p>
                  )}
                  <p className="font-semibold text-sm mt-1" style={{ color: '#F5A623' }}>
                    {formatPrice(item.price_kobo)}
                  </p>
                  {soldOut && <p className="text-xs text-red-400 mt-1">Sold out</p>}
                </div>

                {/* Add button */}
                <div className="shrink-0 flex flex-col items-center justify-center">
                  {qty > 0 ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQuantity(item.id, qty - 1)}
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg"
                        style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}
                        disabled={isClosed || soldOut}
                      >
                        −
                      </button>
                      <span className="text-sm font-semibold w-4 text-center">{qty}</span>
                      <button
                        onClick={() => handleAdd(item)}
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg"
                        style={{ background: '#F5A623', color: '#000' }}
                        disabled={isClosed || soldOut}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleAdd(item)}
                      disabled={isClosed || soldOut}
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-xl disabled:opacity-30"
                      style={{ background: '#F5A623', color: '#000' }}
                      aria-label={`Add ${item.name}`}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Sticky cart bar */}
      {totalItems > 0 && cart.vendor_id === vendor.id && (
        <div className="fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => router.push('/cart')}
              className="w-full rounded-2xl py-4 flex items-center justify-between px-5 font-semibold"
              style={{ background: '#F5A623', color: '#000' }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                style={{ background: 'rgba(0,0,0,0.15)' }}
              >
                {totalItems}
              </span>
              <span>View Cart</span>
              <span>{formatPrice(subtotal)}</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
