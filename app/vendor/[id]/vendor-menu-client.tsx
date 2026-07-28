'use client'

import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import Image from 'next/image'
import { FOOD_BLUR } from '@/lib/blur'
import { useRouter } from 'next/navigation'
import { useCart, cartLineKey, type CartItem, type CartAddon } from '@/components/cart-context'
import { formatPrice } from '@/lib/money'
import { vendorTrustBadges } from '@/lib/vendor-trust'
import { VerifiedBadge } from '@/components/verified-badge'
import { Badge } from '@/components/ui/badge'
import { Pill } from '@/components/ui/pill'
import { FindStoreCard } from '@/components/find-store-card'
import { getCampaignSessionId, trackCampaignEvent } from '@/lib/campaign-client'
import { recordFeedCommerceEvent } from '@/lib/feed/client-attribution'
import { ArrowLeft, Clock3, MapPin, Search, Share2, Star, Users } from 'lucide-react'
import type { VendorInfo, MenuAddon, MenuItem, VendorReview } from './page'

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

export function VendorMenuClient({ vendor, menu, reviews = [], loggedOut = false, campaignId = '', initialMenuItemId = '' }: { vendor: VendorInfo; menu: MenuItem[]; reviews?: VendorReview[]; loggedOut?: boolean; campaignId?: string; initialMenuItemId?: string }) {
  const router = useRouter()
  const { cart, addItem, clearCart, totalItems, subtotal } = useCart()
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [showConflict, setShowConflict] = useState(false)
  const [pendingItem, setPendingItem] = useState<CartItem | null>(null)

  // Add-on selection sheet
  const [selecting, setSelecting] = useState<MenuItem | null>(null)
  // Transient "+1" fly-to-cart cue: { id: which item, n: nonce to replay }.
  const [fly, setFly] = useState<{ id: string; n: number } | null>(null)
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([])
  const [itemNotes, setItemNotes] = useState('')
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [shareFeedback, setShareFeedback] = useState('')
  const [groupForm, setGroupForm] = useState(() => ({
    name: '',
    delivery_address: '',
    delivery_type: 'BIKE' as 'BIKE' | 'DOOR' | 'PICKUP',
    deadline: localDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    budget_naira: '',
    participant_limit: '8',
    shared_note: '',
  }))
  const sentProfileOpen = useRef(false)
  const sentMenuItems = useRef<Set<string>>(new Set())
  const openedLinkedItem = useRef(false)

  const isPaused = Boolean(vendor.paused_until && new Date(vendor.paused_until) > new Date())
  const isClosed = vendor.status === 'CLOSED' || isPaused

  // Remember this vendor for a logged-out visitor (arrived via the share link) so
  // that after ANY login/signup they're returned here — even if they reach auth
  // by a route that didn't carry a ?next=.
  useEffect(() => {
    if (loggedOut) {
      try { sessionStorage.setItem('lx_return_vendor', `/vendor/${vendor.id}`) } catch { /* ignore */ }
    }
  }, [loggedOut, vendor.id])

  useEffect(() => {
    if (!campaignId) return
    try { sessionStorage.setItem('lx_campaign_id', campaignId) } catch { /* ignore */ }
  }, [campaignId])

  useEffect(() => {
    if (!campaignId || sentProfileOpen.current) return
    sentProfileOpen.current = true
    trackCampaignEvent({
      campaignId,
      vendorId: vendor.id,
      eventType: 'vendor_profile_opened',
      source: 'vendor',
      placement: 'vendor_page_header',
      targetType: 'vendor',
      targetId: vendor.id,
      sessionId: getCampaignSessionId(),
      metadata: { vendor_name: vendor.shop_name },
    })
  }, [campaignId, vendor.id, vendor.shop_name])

  const vendorNext = encodeURIComponent(`/vendor/${vendor.id}`)

  const filtered = useMemo(() => {
    return menu.filter((item) => {
      const matchCat = activeCategory === 'All' || item.category.toUpperCase() === activeCategory.toUpperCase()
      const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
      return matchCat && matchSearch
    })
  }, [menu, activeCategory, search])

  useEffect(() => {
    if (!initialMenuItemId || openedLinkedItem.current) return
    const item = menu.find((candidate) => candidate.id === initialMenuItemId && candidate.is_available)
    if (!item) return
    openedLinkedItem.current = true
    setSelecting(item)
    setSelectedAddonIds([])
    setItemNotes('')
  }, [initialMenuItemId, menu])

  useEffect(() => {
    if (!campaignId) return
    const next = filtered.slice(0, 6).filter((item) => !sentMenuItems.current.has(item.id))
    for (const item of next) {
      sentMenuItems.current.add(item.id)
      trackCampaignEvent({
        campaignId,
        vendorId: vendor.id,
        eventType: 'menu_item_opened',
        source: 'menu',
        placement: 'vendor_menu_list',
        targetType: 'menu_item',
        targetId: item.id,
        sessionId: getCampaignSessionId(),
        metadata: { item_name: item.name },
      })
    }
  }, [campaignId, filtered, vendor.id])

  function buildCartItem(item: MenuItem, addons: CartAddon[], notes = ''): CartItem {
    return {
      id: cartLineKey(item.id, addons),
      menu_item_id: item.id,
      name: item.name,
      price_kobo: item.price_kobo,
      image_url: item.image_url,
      quantity: 1,
      special_instructions: notes.trim() || undefined,
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
      return
    }
    void recordFeedCommerceEvent('add_to_cart', vendor.id)
    if (campaignId) {
      trackCampaignEvent({
        campaignId,
        vendorId: vendor.id,
        eventType: 'item_added_to_cart',
        source: 'menu',
        placement: 'vendor_menu_add_button',
        targetType: 'menu_item',
        targetId: cartItem.menu_item_id,
        sessionId: getCampaignSessionId(),
        metadata: { item_name: cartItem.name, addons: cartItem.addons.length },
      })
    }
    // Trigger the floating "+1" on this item's button (nonce remounts → replays).
    setFly((current) => ({ id: cartItem.menu_item_id, n: (current?.n ?? 0) + 1 }))
  }

  function handleAdd(item: MenuItem) {
    if (isClosed) return
    setSelecting(item)
    setSelectedAddonIds([])
    setItemNotes('')
  }

  function confirmAddons() {
    if (!selecting) return
    const required = selecting.addons.filter((addon) => addon.is_required)
    const requiredSelected = required.filter((addon) => selectedAddonIds.includes(addon.id))
    if (required.length > 0 && requiredSelected.length !== 1) return
    const chosen = selecting.addons.filter((a) => selectedAddonIds.includes(a.id))
    doAdd(buildCartItem(selecting, chosen.map((a) => ({ id: a.id, name: a.name, price_kobo: a.price_kobo })), itemNotes))
    setSelecting(null)
    setSelectedAddonIds([])
    setItemNotes('')
  }

  function toggleAddon(addon: MenuAddon) {
    setSelectedAddonIds((current) => {
      const checked = current.includes(addon.id)
      if (addon.is_required) {
        const requiredIds = new Set(selecting?.addons.filter((choice) => choice.is_required).map((choice) => choice.id) ?? [])
        const withoutRequired = current.filter((id) => !requiredIds.has(id))
        return checked ? withoutRequired : [...withoutRequired, addon.id]
      }
      return checked ? current.filter((id) => id !== addon.id) : [...current, addon.id]
    })
  }

  function handleConflictConfirm() {
    if (!pendingItem) return
    clearCart()
    addItem(vendor.id, vendor.shop_name, pendingItem)
    setShowConflict(false)
    setPendingItem(null)
  }

  async function startGroupOrder() {
    if (loggedOut) {
      router.push(`/auth?next=${encodeURIComponent(`/vendor/${vendor.id}`)}`)
      return
    }
    if (groupForm.delivery_address.trim().length < 5) { setGroupError('Add one delivery destination for the group.'); return }
    setGroupBusy(true)
    setGroupError('')
    try {
      const response = await fetch('/api/group-order/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: vendor.id,
          name: groupForm.name.trim() || undefined,
          delivery_address: groupForm.delivery_address.trim(),
          delivery_type: groupForm.delivery_type,
          deadline: new Date(groupForm.deadline).toISOString(),
          per_person_budget_kobo: groupForm.budget_naira ? Number(groupForm.budget_naira) * 100 : null,
          participant_limit: Number(groupForm.participant_limit),
          shared_note: groupForm.shared_note.trim() || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({})) as { code?: string; error?: string }
      if (response.status === 401) { router.push(`/auth?next=${encodeURIComponent(`/vendor/${vendor.id}`)}`); return }
      if (!response.ok || !payload.code) { setGroupError(payload.error ?? 'Could not start the group order.'); return }
      router.push(`/group/${payload.code}`)
    } catch { setGroupError('Connection lost. Try again.') } finally { setGroupBusy(false) }
  }

  async function shareStore() {
    const path = vendor.slug ? `/store/${encodeURIComponent(vendor.slug)}` : `/vendor/${vendor.id}`
    const url = `${window.location.origin}${path}`
    try {
      if (navigator.share) {
        await navigator.share({ title: vendor.shop_name, text: `Order from ${vendor.shop_name} on LumeX Fud`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setShareFeedback('Link copied')
      window.setTimeout(() => setShareFeedback(''), 1800)
    } catch { /* Sharing can be cancelled or unavailable. */ }
  }

  // Total quantity of this menu item across all its add-on variants.
  const qtyForItem = (menuItemId: string) =>
    cart.items.filter((i) => i.menu_item_id === menuItemId).reduce((s, i) => s + i.quantity, 0)

  const selectingTotal = selecting
    ? selecting.price_kobo + selecting.addons.filter((a) => selectedAddonIds.includes(a.id)).reduce((s, a) => s + a.price_kobo, 0)
    : 0
  const requiredAddons = selecting?.addons.filter((addon) => addon.is_required) ?? []
  const optionalAddons = selecting?.addons.filter((addon) => !addon.is_required) ?? []
  const requiredSelectionComplete = requiredAddons.length === 0 || requiredAddons.filter((addon) => selectedAddonIds.includes(addon.id)).length === 1

  return (
    <>
      {showGroupForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={() => setShowGroupForm(false)}>
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-[#111113] p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Start group order</h2><p className="mt-1 text-xs text-white/50">One vendor, one destination, organizer pays.</p></div><button onClick={() => setShowGroupForm(false)} aria-label="Close group form" className="h-11 w-11 rounded-xl border border-white/10">Close</button></div>
            <div className="mt-5 grid gap-4">
              <GroupField label="Group name"><input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value.slice(0, 80) })} className="lx-field w-full px-3 py-2.5" placeholder="Friday lunch" /></GroupField>
              <GroupField label="Delivery destination"><input value={groupForm.delivery_address} onChange={(event) => setGroupForm({ ...groupForm, delivery_address: event.target.value.slice(0, 500) })} className="lx-field w-full px-3 py-2.5" placeholder="Hall, block, room or pickup point" /></GroupField>
              <div className="grid grid-cols-2 gap-3"><GroupField label="Fulfilment"><select value={groupForm.delivery_type} onChange={(event) => setGroupForm({ ...groupForm, delivery_type: event.target.value as 'BIKE' | 'DOOR' | 'PICKUP' })} className="lx-field w-full px-3 py-2.5"><option value="BIKE">Bike delivery</option><option value="DOOR">Door delivery</option><option value="PICKUP">Pickup</option></select></GroupField><GroupField label="Deadline"><input type="datetime-local" value={groupForm.deadline} onChange={(event) => setGroupForm({ ...groupForm, deadline: event.target.value })} className="lx-field w-full px-3 py-2.5" /></GroupField></div>
              <div className="grid grid-cols-2 gap-3"><GroupField label="Budget per person"><input inputMode="numeric" value={groupForm.budget_naira} onChange={(event) => setGroupForm({ ...groupForm, budget_naira: event.target.value.replace(/[^0-9]/g, '') })} className="lx-field w-full px-3 py-2.5" placeholder="Optional NGN" /></GroupField><GroupField label="Participant limit"><input inputMode="numeric" value={groupForm.participant_limit} onChange={(event) => setGroupForm({ ...groupForm, participant_limit: event.target.value.replace(/[^0-9]/g, '').slice(0, 2) })} className="lx-field w-full px-3 py-2.5" /></GroupField></div>
              <GroupField label="Shared note"><textarea value={groupForm.shared_note} onChange={(event) => setGroupForm({ ...groupForm, shared_note: event.target.value.slice(0, 300) })} rows={2} className="lx-field w-full resize-none px-3 py-2.5" placeholder="Optional note for everyone" /></GroupField>
              {groupError && <p className="text-sm text-red-300">{groupError}</p>}
              <button onClick={startGroupOrder} disabled={groupBusy || isClosed} className="lx-btn-amber min-h-13 w-full disabled:opacity-50">{groupBusy ? 'Starting...' : 'Create group and get link'}</button>
            </div>
          </div>
        </div>
      )}
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
        <div className="fixed inset-0 z-[60] flex items-end justify-center lx-scrim" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSelecting(null)}>
          <div className="lx-sheet glass-thick w-full max-w-lg p-5 space-y-4 max-h-[min(88dvh,680px)] overflow-y-auto overscroll-contain scroll-pb-28" style={{ borderRadius: '28px 28px 0 0' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="min-w-0 pr-3">
                <h3 className="font-semibold text-lg leading-snug break-words">{selecting.name}</h3>
                <p className="lx-amber text-sm">{formatPrice(selecting.price_kobo)}</p>
              </div>
              <button onClick={() => setSelecting(null)} className="h-11 shrink-0 rounded-xl px-3 text-sm text-white/60" style={{ background: 'rgba(255,255,255,0.06)' }}>Close</button>
            </div>

            {requiredAddons.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/60">Required choice</p>
                  <span className="text-xs text-amber-300">Choose 1</span>
                </div>
                <div className="space-y-2">
                  {requiredAddons.map((a) => {
                    const checked = selectedAddonIds.includes(a.id)
                    return (
                      <button key={a.id}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => toggleAddon(a)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                        style={{ background: checked ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${checked ? '#F5A623' : 'rgba(255,255,255,0.07)'}` }}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: checked ? '#F5A623' : 'transparent', border: `2px solid ${checked ? '#F5A623' : 'rgba(255,255,255,0.3)'}` }}>
                          {checked && <div className="h-2 w-2 rounded-full bg-black" />}
                        </div>
                        <span className="min-w-0 flex-1 break-words text-sm leading-snug">{a.name}</span>
                        <span className="shrink-0 text-sm text-white/60">{a.price_kobo > 0 ? `+${formatPrice(a.price_kobo)}` : 'Included'}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {optionalAddons.length > 0 && (
              <>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Optional extras</p>
                <div className="space-y-2">
                  {optionalAddons.map((a) => {
                    const checked = selectedAddonIds.includes(a.id)
                    return (
                      <button key={a.id}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleAddon(a)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                        style={{ background: checked ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${checked ? '#F5A623' : 'rgba(255,255,255,0.07)'}` }}>
                        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                          style={{ background: checked ? '#F5A623' : 'transparent', border: `2px solid ${checked ? '#F5A623' : 'rgba(255,255,255,0.3)'}` }}>
                          {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                        </div>
                        <span className="min-w-0 flex-1 break-words text-sm leading-snug">{a.name}</span>
                        <span className="shrink-0 text-sm text-white/60">+{formatPrice(a.price_kobo)}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40" htmlFor="item-notes">Item note</label>
              <textarea
                id="item-notes"
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value.slice(0, 200))}
                placeholder="Optional kitchen note"
                rows={2}
                className="lx-field w-full resize-none px-4 py-3 text-sm outline-none"
              />
              <p className="mt-1 text-right text-xs text-white/30">{itemNotes.length}/200</p>
            </div>

            {/* Sticky footer so the confirm button is always reachable, even with
                a long add-on list on a small phone. */}
            <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]" style={{ background: 'linear-gradient(to top, var(--lx-surface-solid) 72%, transparent)' }}>
              <button onClick={confirmAddons} disabled={!requiredSelectionComplete} className="lx-btn-amber w-full rounded-2xl py-4 disabled:cursor-not-allowed disabled:opacity-50">
                {requiredSelectionComplete ? `Add to cart · ${formatPrice(selectingTotal)}` : 'Choose 1 required option'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cover hero — the vendor's cover photo (or a branded gradient) with the
          logo overlaid, so the storefront never opens on a blank header. */}
      <section className="border-b border-white/10 bg-[#10120f]">
        <div className="relative h-48 overflow-hidden bg-[#252a22] sm:h-64">
          {vendor.shop_photo_url ? <Image src={vendor.shop_photo_url} alt={`${vendor.shop_name} food`} fill priority className="object-cover" sizes="100vw" placeholder="blur" blurDataURL={FOOD_BLUR} /> : null}
          <div aria-hidden="true" className="absolute inset-0 bg-black/35" />
          <div className="absolute inset-x-0 top-0 mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <button type="button" onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm" aria-label="Go back"><ArrowLeft size={20} /></button>
            <button type="button" onClick={() => void shareStore()} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm" aria-label="Share store"><Share2 size={19} /></button>
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-5 sm:px-6 lg:px-8">
          <div className="flex items-end gap-4">
            <div className="relative -mt-11 flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-lg border-4 border-[#10120f] bg-[#252a22]">
              {vendor.logo_url ? <Image src={vendor.logo_url} alt={vendor.shop_name} fill className="object-cover" sizes="88px" /> : <span className="text-2xl font-bold text-white/70">{vendor.shop_name.slice(0, 1)}</span>}
            </div>
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold leading-tight text-white sm:text-2xl">{vendor.shop_name}</h1>{vendor.kyc_verified && <VerifiedBadge kind="vendor" />}</div>
              <p className="mt-1 text-sm text-white/55">{vendor.category || 'Food vendor'}</p>
            </div>
          </div>
          {vendor.description ? <p className="mt-4 max-w-3xl text-sm leading-6 text-white/70">{vendor.description}</p> : null}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/65">
            <span className={`inline-flex items-center gap-1.5 font-semibold ${isClosed ? 'text-red-300' : 'text-emerald-300'}`}><span className={`h-2 w-2 rounded-full ${isClosed ? 'bg-red-400' : 'bg-emerald-400'}`} />{isPaused ? 'Temporarily paused' : vendor.status === 'CLOSED' ? `Closed${vendor.opening_time ? ` - opens ${vendor.opening_time}` : ''}` : 'Open for orders'}</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 size={14} />{vendor.prep_time_minutes}-{vendor.prep_time_minutes + 10} min</span>
            {vendor.total_ratings > 0 ? <span className="inline-flex items-center gap-1.5"><Star size={14} className="fill-[#F5A623] text-[#F5A623]" />{vendor.avg_rating.toFixed(1)} ({vendor.total_ratings})</span> : null}
            {vendor.address_text ? <span className="inline-flex min-w-0 items-center gap-1.5 truncate"><MapPin size={14} />{vendor.address_text}</span> : null}
          </div>
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={() => { setGroupError(''); setShowGroupForm(true) }} disabled={isClosed} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white/85 disabled:opacity-50"><Users size={16} />Start group order</button>
            {shareFeedback ? <span role="status" className="self-center text-sm text-emerald-300">{shareFeedback}</span> : null}
          </div>
        </div>
      </section>

      <div className="sticky top-0 z-40 border-b border-white/10 bg-[#10120f]/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="relative"><Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${vendor.shop_name}'s menu`} aria-label="Search menu" className="lx-field w-full py-2.5 pl-10 pr-4 text-sm outline-none" /></div>
          <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-none">
            {CATEGORIES.map((cat) => <Pill key={cat} active={activeCategory === cat} onClick={() => setActiveCategory(cat)} className="shrink-0 px-3 py-1.5 text-xs">{cat}</Pill>)}
          </div>
        </div>
      </div>

      {/* Sticky header */}
      <div className="hidden" aria-hidden="true">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button type="button" onClick={() => router.back()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-transform hover:bg-white/10 hover:text-white active:scale-90" aria-label="Go back">
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
          <div className="lx-card-amber mx-auto mb-2 max-w-5xl rounded-xl px-4 py-3">
            <p className="text-sm text-white/85 mb-2">Order to your hostel — you’ll come right back to this page.</p>
            <div className="flex gap-2">
              <a href={`/auth/register?next=${vendorNext}`} className="lx-btn-amber flex-1 text-center py-2 rounded-lg text-sm">Create account</a>
              <a href={`/auth?next=${vendorNext}`} className="flex-1 text-center py-2 rounded-lg text-sm font-semibold" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>Log in</a>
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-3 scrollbar-none sm:px-6 lg:px-8">
          {CATEGORIES.map((cat) => (
            <Pill key={cat} active={activeCategory === cat} onClick={() => setActiveCategory(cat)} className="shrink-0 px-3 py-1.5 text-xs">
              {cat}
            </Pill>
          ))}
        </div>
      </div>

      {/* Find this store — address, landmark, storefront photo + one-tap directions */}
      <div className="hidden" aria-hidden="true">
        <FindStoreCard vendor={vendor} shopName={vendor.shop_name} />
        <button type="button" onClick={() => { setGroupError(''); setShowGroupForm(true) }} disabled={isClosed} className="mt-3 min-h-12 w-full rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-semibold text-amber-200 disabled:opacity-50">
          Start group order
        </button>
      </div>

      {menu.length > 10 && (
        <div className="hidden">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu..." aria-label="Search menu"
            className="lx-field w-full px-4 py-2.5 text-sm outline-none" />
        </div>
      )}

      <div className="mx-auto flex max-w-5xl items-end justify-between gap-4 px-4 pb-1 pt-6 sm:px-6 lg:px-8">
        <div>
          <p className="lx-mono text-[var(--color-amber)]">Order from the kitchen</p>
          <h2 className="mt-1 text-xl font-bold text-white">Menu</h2>
        </div>
        <span className="rounded-full border border-white/8 bg-white/[0.05] px-3 py-1 text-xs text-white/50 tabular-nums">{filtered.length} items</span>
      </div>

      {/* Menu items */}
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 px-4 py-4 sm:px-6 md:grid-cols-3 lg:grid-cols-4 lg:px-8 lx-stagger">
        {filtered.length === 0 ? (
          <div className="col-span-full px-6 py-16 text-center">
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
              <div key={item.id} className="glass-thin relative flex min-w-0 flex-col overflow-hidden transition-transform hover:-translate-y-1 hover:border-white/15" style={{ opacity: soldOut ? 0.5 : 1 }}>
                <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-white/5">
                  {item.image_url
                    ? <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="(max-width: 512px) 50vw, 240px" placeholder="blur" blurDataURL={FOOD_BLUR} />
                    : <div className="w-full h-full flex items-center justify-center text-white/15"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg></div>}
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-3 pb-14">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{item.name}</h3>
                  {item.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/48">{item.description}</p>}
                  <p className="lx-amber mt-2 text-[15px] font-semibold">{formatPrice(item.price_kobo)}</p>
                  {item.prep_time_minutes != null && <p className="text-xs text-white/40 mt-0.5">⏱ {item.prep_time_minutes} min</p>}
                  {item.addons.length > 0 && <p className="mt-1 text-[10px] text-white/30">{item.addons.length} add-on{item.addons.length === 1 ? '' : 's'}</p>}
                  {soldOut && <p className="text-xs text-red-400 mt-1">Sold out</p>}
                </div>
                <div className="absolute bottom-3 right-3 flex shrink-0 flex-col items-center justify-center">
                  {/* Floating "+1" cue rising from the button on add */}
                  {fly?.id === item.id && (
                    <span key={fly.n} className="lx-flyplus absolute top-0 left-1/2 -translate-x-1/2 font-bold text-sm pointer-events-none z-10" style={{ color: '#F5A623' }} aria-hidden="true">+1</span>
                  )}
                  <button onClick={() => handleAdd(item)} disabled={isClosed || soldOut}
                    className="relative flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold transition-transform hover:scale-105 active:scale-90 disabled:opacity-30"
                    style={{ background: '#F5A623', color: '#000', boxShadow: '0 0 16px rgba(245,166,35,0.35)', minHeight: 44 }} aria-label={`Add ${item.name}`}>
                    <span className="text-2xl leading-none" aria-hidden="true">+</span>
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
      <div className="mx-auto max-w-5xl px-4 pb-2 pt-8 sm:px-6 lg:px-8">
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
            <p className="text-xs text-white/35 mt-1">Order, taste, and leave a quick review so the next customer can choose with confidence.</p>
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
          <div className="mx-auto max-w-5xl">
            <button onClick={() => {
              try {
                const id = campaignId || sessionStorage.getItem('lx_campaign_id') || ''
                if (id) sessionStorage.setItem('lx_campaign_id', id)
              } catch { /* ignore */ }
              router.push('/cart')
            }} className="lx-btn-amber w-full py-4 flex items-center justify-between px-5" style={{ borderRadius: 16 }}>
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

function GroupField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs text-white/60"><span className="mb-1.5 block">{label}</span>{children}</label>
}

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
