'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart-context'
import { BottomNav } from '@/components/nav-bottom'
import { formatPrice } from '@/lib/money'
import { useFeatures } from '@/lib/use-features'
import { estimateOrderPrepMinutes, prepRangeLabel } from '@/lib/prep-time'
import { formatHoursRange } from '@/lib/hours'
import { type MapLodge } from '@/components/lodge-map'
import { DeliveryAddress } from '@/components/delivery-address'
import { CartRewardHint } from '@/components/cart-reward-hint'
import { composeDeliveryAddress, lodgeBlocksFor, type DeliveryAddressParts } from '@/lib/delivery-address'

const TIP_OPTIONS = [0, 10000, 20000, 50000]

type PaymentMethod = 'PAYSTACK' | 'WALLET' | 'SPLIT'

type DeliveryLocationRow = {
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  zone_id: string
  zone_name: string
  base_bike_fee_kobo: number
  base_door_fee_kobo: number
  platform_markup_kobo: number
  rider_cut_bike_kobo: number
  rider_cut_door_kobo: number
  uses_lodge_catalog: boolean
}

function CartSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="lx-surface p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white/85">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-white/45">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export default function CartPage() {
  const router = useRouter()
  const { cart, setQuantity, clearCart, subtotal, totalItems } = useCart()
  const features = useFeatures()
  const [groupBusy, setGroupBusy] = useState(false)
  const [locations,     setLocations]     = useState<DeliveryLocationRow[]>([])
  const [selectedState, setSelectedState] = useState('')
  const [selectedCityId, setSelectedCityId] = useState('')
  const [selectedZoneId, setSelectedZoneId] = useState('')

  const [deliveryType,  setDeliveryType]  = useState<'BIKE' | 'DOOR' | 'PICKUP'>('BIKE')
  // Structured delivery address — composed into one rider-clear string at checkout.
  const [addr,          setAddr]          = useState<DeliveryAddressParts>({ lodge: '', block: '', room: '', landmark: '' })
  const [instructions,  setInstructions]  = useState('')
  const [tip,           setTip]           = useState(0)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  // Binding 1h25m pickup agreement (Invariant I8) — gates the Pay button.
  const [pickupAgree,   setPickupAgree]   = useState(false)
  // Delivery acceptance of Terms + Refund policy — gates the Pay button.
  const [orderAgree,    setOrderAgree]    = useState(false)
  // Optional leave-at-gate (delivery handover) — never compulsory.
  const [leaveAtGate,   setLeaveAtGate]   = useState(false)
  const [feeInfo,       setFeeInfo]       = useState(false)
  const [deliveryInfo,  setDeliveryInfo]  = useState(false)
  const [applyReward,   setApplyReward]   = useState(false)
  const [scheduleOn,    setScheduleOn]    = useState(false)
  const [scheduleAt,    setScheduleAt]    = useState('') // datetime-local string
  const [reorderNote,   setReorderNote]   = useState('') // "some items skipped" after Order again
  const [fees,          setFees]          = useState<{ bike: number; door: number; markup: number; bonus: number } | null>(null)
  const [hoursLabel,    setHoursLabel]    = useState('7am – 10pm') // live opening hours

  // ── Wallet state ──────────────────────────────────────────────────────────
  const [walletBalance,    setWalletBalance]    = useState<number | null>(null)
  const [walletFrozen,     setWalletFrozen]     = useState(false)
  const [walletLoading,    setWalletLoading]    = useState(true)
  const [paymentMethod,    setPaymentMethod]    = useState<PaymentMethod>('PAYSTACK')
  // Saved delivery addresses (learned over time from past orders).
  const [savedAddresses,   setSavedAddresses]   = useState<string[]>([])
  // Verified ABSU lodge catalog (names, coords, blocks) — feeds search, the map,
  // and the per-lodge block dropdown.
  const [catalogLodges,    setCatalogLodges]    = useState<MapLodge[]>([])
  // GPS for this delivery (from "use my location" or a map/lodge pin). Cleared
  // when the address is hand-edited so coords never mismatch the text.
  const [coords,           setCoords]           = useState<{ lat: number; lng: number } | null>(null)
  const [gpsBusy,          setGpsBusy]          = useState(false)
  const [gpsMessage,       setGpsMessage]       = useState('')

  useEffect(() => {
    fetch('/api/settings/fees')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { bike_delivery_fee_kobo: number; door_delivery_fee_kobo: number; platform_markup_kobo: number; topup_bonus_percent?: number; hours_open?: string; hours_close?: string } | null) => {
        if (d) {
          setFees({ bike: d.bike_delivery_fee_kobo, door: d.door_delivery_fee_kobo, markup: d.platform_markup_kobo, bonus: d.topup_bonus_percent ?? 0 })
          if (d.hours_open && d.hours_close) setHoursLabel(formatHoursRange(d.hours_open, d.hours_close))
        }
      })
      .catch(() => {})

    // Load customer wallet balance — keep it even when 0 so Wallet is always an
    // explicit choice next to Paystack (with a top-up prompt when short). A frozen
    // wallet can't pay, so it's flagged and not selectable. Skipped entirely when
    // the customer wallet is disabled (the balance endpoint 403s anyway) — but we
    // still clear the loading flag so the Paystack-only selector renders.
    if (features.customer_wallet_enabled === true) {
      fetch('/api/customer-wallet/balance')
        .then((r) => r.ok ? r.json() : null)
        .then((d: { balance_kobo: number; is_frozen: boolean } | null) => {
          if (d) {
            setWalletFrozen(!!d.is_frozen)
            if (!d.is_frozen) setWalletBalance(d.balance_kobo ?? 0)
          }
        })
        .catch(() => {})
        .finally(() => setWalletLoading(false))
    } else {
      setWalletLoading(false)
    }

    // Delivery suggestions = the customer's own learned lodges first, then the
    // admin-verified ABSU lodge catalog. Pre-fill the customer's most-used.
    Promise.all([
      fetch('/api/customer/addresses').then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/lodges').then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/delivery-locations').then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([addrRes, lodgeRes, locationRes]: [{ addresses?: string[] } | null, { lodges?: MapLodge[] } | null, { locations?: DeliveryLocationRow[] } | null]) => {
      const personal = addrRes?.addresses ?? []
      const lodges = lodgeRes?.lodges ?? []
      const nextLocations = locationRes?.locations ?? []
      const catalog = lodges.map((l) => l.area ? `${l.name} (${l.area})` : l.name)
      const merged: string[] = [...personal]
      for (const l of catalog) if (!merged.includes(l)) merged.push(l)
      setSavedAddresses(merged)
      setCatalogLodges(lodges)
      setLocations(nextLocations)
      if (nextLocations.length > 0) {
        const first = nextLocations[0]
        setSelectedState((cur) => cur || first.city_state)
        setSelectedCityId((cur) => cur || first.city_id)
        setSelectedZoneId((cur) => cur || first.zone_id)
      }
      // A "Saved places → Order here" tap pre-fills the chosen place (takes
      // priority over the learned default); otherwise fall back to most-used.
      let prefill: string | null = null
      try { prefill = sessionStorage.getItem('lx_prefill_address'); if (prefill) sessionStorage.removeItem('lx_prefill_address') } catch { /* ignore */ }
      const seed = prefill || (personal.length > 0 ? personal[0] : '')
      if (seed) setAddr((cur) => cur.lodge ? cur : { ...cur, lodge: seed })
    }).catch(() => {})

    // Surface any items "Order again" had to drop (no longer on the menu).
    try {
      const skipped = sessionStorage.getItem('reorder_skipped')
      if (skipped) {
        setReorderNote(`Some items were unavailable and left out: ${skipped}`)
        sessionStorage.removeItem('reorder_skipped')
      }
    } catch { /* ignore */ }
  }, [])

  const isPickup        = deliveryType === 'PICKUP'
  const stateOptions = useMemo(() => Array.from(new Set(locations.map((row) => row.city_state))), [locations])
  const cityOptions = useMemo(
    () => locations.filter((row) => row.city_state === selectedState)
      .filter((row, index, all) => all.findIndex((candidate) => candidate.city_id === row.city_id) === index),
    [locations, selectedState],
  )
  const zoneOptions = useMemo(
    () => locations.filter((row) => row.city_id === selectedCityId),
    [locations, selectedCityId],
  )
  const selectedZone = useMemo(
    () => zoneOptions.find((row) => row.zone_id === selectedZoneId) ?? null,
    [zoneOptions, selectedZoneId],
  )
  const selectedCity = useMemo(
    () => cityOptions.find((row) => row.city_id === selectedCityId) ?? null,
    [cityOptions, selectedCityId],
  )
  const showLodgeCatalog = selectedZone?.uses_lodge_catalog === true
  const addressSuggestions = showLodgeCatalog ? savedAddresses : []
  const locationLodges = showLodgeCatalog ? catalogLodges : []
  // Fold the structured parts into one rider-clear line ("Lodge · Block B · Room 12 · landmark").
  const composedAddress = isPickup ? '' : composeDeliveryAddress(deliveryType as 'BIKE' | 'DOOR', addr)
  const deliveryFees = selectedZone
    ? { BIKE: selectedZone.base_bike_fee_kobo, DOOR: selectedZone.base_door_fee_kobo }
    : fees
      ? { BIKE: fees.bike, DOOR: fees.door }
      : { BIKE: 0, DOOR: 0 }
  // Pickup charges the SAME platform fee as delivery — just ₦0 delivery, no tip.
  const platformMarkup  = selectedZone?.platform_markup_kobo ?? fees?.markup ?? 0
  const deliveryFee     = isPickup ? 0 : deliveryFees[deliveryType as 'BIKE' | 'DOOR']
  const tipApplied      = isPickup ? 0 : tip
  const total           = subtotal + platformMarkup + deliveryFee + tipApplied

  // Longest-dish prep estimate from the per-item times captured at add-time
  // (falls back to a 25-min default for any item saved before that field existed).
  const prepMinutes     = estimateOrderPrepMinutes(cart.items.map((i) => ({ prepTimeMinutes: i.prep_time_minutes ?? null })), 25)

  // ── Wallet payment math ────────────────────────────────────────────────────
  const walletUsable     = walletBalance !== null && walletBalance > 0
  const walletCoversAll  = walletUsable && walletBalance! >= total
  const walletAmount     = walletUsable ? Math.min(walletBalance!, total) : 0
  const paystackAmount   = Math.max(0, total - walletAmount)
  const topUpNeeded      = Math.max(0, total - (walletBalance ?? 0))

  // Resolve the chosen method to what will actually run: wallet covers all →
  // WALLET; partial → SPLIT; empty wallet but "wallet" tapped → PAYSTACK.
  const effectivePaymentMethod: PaymentMethod =
    paymentMethod === 'WALLET'
      ? (walletCoversAll ? 'WALLET' : walletAmount > 0 ? 'SPLIT' : 'PAYSTACK')
      : 'PAYSTACK'

  // Scheduling bounds for the datetime-local picker (local-time strings). The
  // chosen time is the SEND time (when the order reaches the vendor); ~25 min
  // minimum lead so it isn't effectively immediate; up to 7 days ahead.
  const toLocalInput = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const scheduleMin = toLocalInput(new Date(Date.now() + 25 * 60_000))
  const scheduleMax = toLocalInput(new Date(Date.now() + 7 * 86_400_000))

  async function captureCurrentLocation(savePin = false) {
    if (!('geolocation' in navigator)) {
      setGpsMessage('Location is not supported on this device')
      return
    }
    setGpsBusy(true)
    setGpsMessage('')
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setCoords(next)
      setGpsMessage(`Captured ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`)
      if (savePin) {
        try {
          const primary = await fetch('/api/customer/locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label: 'Current GPS pin',
              delivery_note: 'Saved from cart',
              latitude: next.lat,
              longitude: next.lng,
              is_active: true,
            }),
          })
          if (primary.ok) {
            setGpsMessage('Captured and saved to your locations')
          } else {
            const fallback = await fetch('/api/customer/places', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: 'Current GPS pin',
                landmark: 'Saved from cart',
                latitude: next.lat,
                longitude: next.lng,
                is_default: true,
              }),
            })
            if (fallback.ok) {
              setGpsMessage('Captured and saved to your places')
            } else {
              const data = await primary.json().catch(() => ({})) as { error?: string }
              const fallbackData = await fallback.json().catch(() => ({})) as { error?: string }
              setGpsMessage(data.error ?? fallbackData.error ?? 'Captured location but could not save the pin')
            }
          }
        } catch {
          setGpsMessage('Captured location but could not save the pin')
        }
      }
      setGpsBusy(false)
    }, () => {
      setGpsBusy(false)
      setGpsMessage('Could not get your location')
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 })
  }

  useEffect(() => {
    if (!selectedState && stateOptions.length > 0) setSelectedState(stateOptions[0])
  }, [selectedState, stateOptions])

  useEffect(() => {
    if (cityOptions.length === 0) {
      if (selectedCityId) setSelectedCityId('')
      return
    }
    if (!cityOptions.some((row) => row.city_id === selectedCityId)) {
      setSelectedCityId(cityOptions[0].city_id)
    }
  }, [cityOptions, selectedCityId])

  useEffect(() => {
    if (zoneOptions.length === 0) {
      if (selectedZoneId) setSelectedZoneId('')
      return
    }
    if (!zoneOptions.some((row) => row.zone_id === selectedZoneId)) {
      setSelectedZoneId(zoneOptions[0].zone_id)
    }
  }, [zoneOptions, selectedZoneId])

  if (totalItems === 0) {
    return (
      <main className="lx-page flex flex-col items-center justify-center pb-24 px-5 text-center overflow-hidden">
        <div className="lx-orb lx-orb--amber" aria-hidden="true" />
        <div className="relative z-10 lx-enter flex flex-col items-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5" style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.2)' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Your cart is feeling light</h2>
          <p className="text-sm text-white/45 mt-1.5 max-w-xs">Nothing in here yet — go find something delicious from a campus vendor.</p>
          <button
            onClick={() => router.push('/')}
            className="lx-btn-amber mt-6 px-6 py-3.5"
          >
            Browse vendors
          </button>
        </div>
        <BottomNav />
      </main>
    )
  }

  async function startGroupOrder() {
    if (!cart.vendor_id || cart.items.length === 0) return
    setGroupBusy(true); setError('')
    try {
      const res = await fetch('/api/group-order/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: cart.vendor_id,
          // v1 group orders carry base items only (no add-ons yet).
          items: cart.items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity, notes: i.special_instructions })),
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not start group order.'); return }
      router.push(`/group/${d.code}`)
    } catch { setError('Connection error.') } finally { setGroupBusy(false) }
  }

  async function handleCheckout() {
    if (loading) return // guard against double-submit before the disabled state paints
    if (!isPickup) {
      if (!selectedState || !selectedCityId || !selectedZoneId) { setError('Choose the delivery state, city and area first'); return }
      if (!addr.lodge.trim()) {
        setError(showLodgeCatalog ? 'Please tell us your lodge or hostel' : 'Please enter the delivery address or nearest landmark')
        return
      }
      if (deliveryType === 'DOOR') {
        // If the chosen lodge has defined blocks, the customer must pick one.
        const blocks = lodgeBlocksFor(locationLodges, addr.lodge)
        if (blocks.length > 0 && !addr.block?.trim()) { setError('Please choose your block'); return }
        if (!addr.room?.trim()) { setError('Add your room number so the rider reaches your door'); return }
      }
      if (composedAddress.trim().length < 5) { setError('Please give a clearer delivery address'); return }
    }
    if (!isPickup && scheduleOn && !scheduleAt) { setError('Pick a date and time for your scheduled order'); return }
    if (isPickup && !pickupAgree) { setError('Please accept the pickup collection terms to continue'); return }
    if (!isPickup && !orderAgree) { setError('Please accept the Terms and Refund Policy to continue'); return }
    setError(''); setLoading(true)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id:             cart.vendor_id,
          items:                 cart.items.map((i) => ({
            menu_item_id:          i.menu_item_id,
            quantity:              i.quantity,
            special_instructions:  i.special_instructions,
            addons:                i.addons.map((a) => a.id),
          })),
          delivery_type:         deliveryType,
          // Pickup has no address/tip/schedule/coords/group — the server synthesizes
          // "Pickup at <shop>" and rejects those extras.
          delivery_address:      isPickup ? undefined : composedAddress,
          city_id:               isPickup ? undefined : selectedCityId,
          zone_id:               isPickup ? undefined : selectedZoneId,
          // Structured parts stored alongside the string (rider sees them as chips).
          delivery_lodge:        isPickup ? undefined : addr.lodge.trim() || undefined,
          delivery_block:        isPickup ? undefined : addr.block?.trim() || undefined,
          delivery_room:         isPickup ? undefined : addr.room?.trim() || undefined,
          delivery_instructions: instructions || undefined,
          tip_amount:            isPickup ? 0 : tip,
          payment_method:        effectivePaymentMethod,
          wallet_amount_kobo:    effectivePaymentMethod !== 'PAYSTACK' ? walletAmount : 0,
          apply_reward:          applyReward,
          scheduled_for:         !isPickup && scheduleOn && scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
          delivery_latitude:     isPickup ? undefined : coords?.lat,
          delivery_longitude:    isPickup ? undefined : coords?.lng,
          // Set when this cart was handed over from a group order (host checkout).
          group_order_id:        isPickup ? undefined : (() => { try { return sessionStorage.getItem('lx_group_id') || undefined } catch { return undefined } })(),
          // Binding consent for the 1h25m pickup agreement (Invariant I8).
          pickup_agreement:      isPickup ? pickupAgree : undefined,
          // Optional leave-at-gate for delivery (only when the handover flag is on).
          leave_at_gate:         !isPickup && features.delivery_handover_v1 === true ? leaveAtGate : undefined,
        }),
      })

      const data = await res.json() as {
        error?: string
        authorization_url?: string
        order_number?: string
        order_id?: string
      }

      if (!res.ok) {
        if (res.status === 401) { router.push('/auth?next=/cart'); return }
        setError(data.error ?? 'Failed to create order')
        return
      }

      clearCart()
      try { sessionStorage.removeItem('lx_group_id') } catch { /* ignore */ }

      // Trust the server's resolved split, not the client's guess: it recomputes
      // wallet coverage from the live balance and may downgrade WALLET→SPLIT if
      // the balance dropped. A Paystack URL means there's still an amount to pay;
      // its absence means the wallet covered the whole order.
      if (data.authorization_url) {
        window.location.href = data.authorization_url
        return
      }
      if (data.order_number) {
        router.push(`/order/${data.order_number}`)
        return
      }
      setError('Could not complete checkout. Please try again.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="lx-page pb-32 overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-40 glass-thin px-4 py-3" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90" style={{ background: 'rgba(255,255,255,0.08)' }} aria-label="Go back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h1 className="font-semibold">Your cart</h1>
            <p className="text-xs text-white/40">{cart.vendor_name}</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5 lx-enter">
        {/* Estimated time — longest dish + delivery window */}
        <div className="lx-card-amber rounded-2xl p-3 flex items-center gap-2.5">
          <span className="text-lg" aria-hidden="true">⏱️</span>
          <p className="text-sm">
            <span className="text-white/55">Estimated </span>
            <span className="lx-amber font-semibold">{prepRangeLabel(prepMinutes)}</span>
            <span className="text-white/45"> · prep + delivery</span>
          </p>
        </div>

        {/* Order with friends — start a shared group order seeded with this cart.
            Hidden when the super-admin turns the group_orders feature off. */}
        {features.group_orders !== false && (
          <button
            onClick={startGroupOrder}
            disabled={groupBusy}
            className="lx-card-amber lx-amber w-full rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span aria-hidden="true">👥</span>
            {groupBusy ? 'Starting…' : 'Order with friends (split one delivery)'}
          </button>
        )}

        {!isPickup && (
          <CartSection title="GPS" subtitle="Use your current location for this order, or save it as a pin for later.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void captureCurrentLocation(false)}
                disabled={gpsBusy}
                className="lx-btn-amber py-3 text-sm disabled:opacity-50"
              >
                {gpsBusy ? 'Getting location…' : 'Use current location'}
              </button>
              <button
                type="button"
                onClick={() => void captureCurrentLocation(true)}
                disabled={gpsBusy}
                className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white/75 disabled:opacity-50"
              >
                Save as pin
              </button>
            </div>
            {coords && (
              <p className="text-xs text-white/40">
                Active GPS: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            )}
            {gpsMessage && <p className="text-xs text-white/45">{gpsMessage}</p>}
          </CartSection>
        )}

        <CartSection title="Your items" subtitle={`${totalItems} item${totalItems === 1 ? '' : 's'} from ${cart.vendor_name}`}>
        <div className="glass-thin overflow-hidden rounded-2xl">
          {cart.items.map((item, idx) => {
            const addonsKobo = item.addons.reduce((s, a) => s + a.price_kobo, 0)
            const eachKobo = item.price_kobo + addonsKobo
            return (
            <div key={item.id} className={`flex items-center gap-2 px-3 sm:px-4 py-3 ${idx < cart.items.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                {item.addons.length > 0 && (
                  <p className="text-xs text-white/40 mt-0.5 truncate">+ {item.addons.map((a) => a.name).join(', ')}</p>
                )}
                <p className="text-xs text-white/40 mt-0.5">{formatPrice(eachKobo)} each</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setQuantity(item.id, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
                  style={{ background: 'rgba(255,255,255,0.08)', minWidth: 44, minHeight: 44 }}>−</button>
                <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
                <button onClick={() => setQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
                  style={{ background: '#F5A623', color: '#000', minWidth: 44, minHeight: 44 }}>+</button>
              </div>
              <p className="text-sm font-semibold w-16 sm:w-20 text-right shrink-0 tabular-nums">{formatPrice(eachKobo * item.quantity)}</p>
            </div>
            )
          })}
        </div>
        </CartSection>

        {/* Delivery type */}
        <CartSection title="Delivery" subtitle="Choose how the order gets to you before you set the drop-off details.">
          <div className="grid grid-cols-2 gap-3">
            {(['BIKE', 'DOOR'] as const).map((type) => {
              const selected = deliveryType === type
              return (
              <button key={type} onClick={() => setDeliveryType(type)}
                aria-pressed={selected}
                className="rounded-xl p-4 text-left transition-all active:scale-[0.98]"
                style={{
                  background: selected ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selected ? '#F5A623' : 'rgba(255,255,255,0.08)'}`,
                }}>
                <div className="mb-2" style={{ color: selected ? '#F5A623' : 'rgba(255,255,255,0.7)' }}>
                  {type === 'BIKE'
                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-5l-2.5-6"/><path d="M12 6h3l2 5"/><path d="M6 11h7"/></svg>
                    : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/></svg>}
                </div>
                <p className="text-sm font-semibold">{type === 'BIKE' ? 'Bike' : 'Door'}</p>
                <p className="text-xs text-white/55 mt-0.5 tabular-nums">{formatPrice(deliveryFees[type])}</p>
              </button>
              )
            })}
          </div>

          {/* Pickup (Order Ahead) — skip the queue. Self-hides unless the
              super-admin pickup flag is on. ₦0 delivery, no rider. */}
          {features.pickup_v1 === true && (
            <button onClick={() => setDeliveryType('PICKUP')}
              aria-pressed={isPickup}
              className="w-full mt-3 rounded-xl p-4 text-left transition-all active:scale-[0.99] flex items-center gap-3"
              style={{
                background: isPickup ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isPickup ? '#F5A623' : 'rgba(255,255,255,0.08)'}`,
              }}>
              <div style={{ color: isPickup ? '#F5A623' : 'rgba(255,255,255,0.7)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2">Pickup — skip the queue
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>₦0 delivery</span>
                </p>
                <p className="text-xs text-white/55 mt-0.5">Order from class, walk up, it’s hot and waiting. Same platform fee, no delivery fee.</p>
              </div>
            </button>
          )}
        </CartSection>

        {/* Pickup info — replaces address/schedule when collecting in person */}
        {isPickup && (
          <div className="lx-card-amber rounded-2xl p-4 lx-enter">
            <p className="text-sm font-semibold flex items-center gap-2">🛍️ Collecting from {cart.vendor_name}</p>
            <p className="text-xs text-white/55 mt-1 leading-relaxed">
              Pay now, we’ll send it to the kitchen, and you’ll get a private 6-character code in this app when it’s ready. Show the code at the counter to collect — no delivery, no waiting in line. If the vendor can’t fulfil it, you’re fully refunded.
            </p>
            {/* Binding 1h25m agreement — REQUIRED before paying (Invariant I8). */}
            <label className="flex items-start gap-2.5 mt-3 pt-3 border-t border-white/10 cursor-pointer">
              <input
                type="checkbox"
                checked={pickupAgree}
                onChange={(e) => { setPickupAgree(e.target.checked); if (e.target.checked) setError('') }}
                className="mt-0.5 w-4 h-4 shrink-0 accent-amber-400"
              />
              <span className="text-xs text-white/70 leading-relaxed">
                I understand that once my order is ready it is held for <span className="font-semibold text-white/90">1 hour 25 minutes</span>. If I don’t collect it in that time, the order is cleared and my payment is not refunded. If I’m running late, I’ll contact the vendor. See our <a href="/refunds" target="_blank" className="text-[#F5A623] underline">Refund Policy</a>.
              </span>
            </label>
          </div>
        )}

        {/* Leave-at-gate — OPTIONAL delivery handover (flag-gated, never default) */}
        {!isPickup && features.delivery_handover_v1 === true && (
          <label className="lx-card-amber-soft rounded-2xl p-4 flex items-start gap-2.5 cursor-pointer lx-enter">
            <input type="checkbox" checked={leaveAtGate} onChange={(e) => setLeaveAtGate(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0 accent-amber-400" />
            <span className="text-xs text-white/70 leading-relaxed">
              <span className="font-semibold text-white/90">Leave at my gate</span> (optional) — let the rider drop it without me sharing a code. They may take a proof photo. Otherwise you’ll confirm delivery with a private code at the door.
            </span>
          </label>
        )}

        {/* Schedule for later — delivery only */}
        {!isPickup && (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/80 flex items-center gap-1.5">
                <span aria-hidden="true">🗓️</span> Schedule for later
              </p>
              <p className="text-xs text-white/45 mt-0.5">Pre-order now, pay now, and we’ll send it to the kitchen at the time you pick.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={scheduleOn}
              onClick={() => setScheduleOn((v) => !v)}
              className="relative w-12 h-7 rounded-full transition-colors shrink-0"
              style={{ background: scheduleOn ? '#F5A623' : 'rgba(255,255,255,0.15)' }}
            >
              <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: scheduleOn ? 26 : 4 }} />
            </button>
          </div>
          {scheduleOn && (
            <div className="mt-3 lx-enter">
              <label className="text-xs text-white/50 block mb-1">Send to kitchen at</label>
              <input
                type="datetime-local"
                value={scheduleAt}
                min={scheduleMin}
                max={scheduleMax}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="lx-field w-full px-3 py-2.5 text-sm outline-none"
                style={{ colorScheme: 'dark' }}
              />
              <p className="text-xs text-white/35 mt-1.5">This is when we send it to the kitchen — food arrives a bit after. Within opening hours ({hoursLabel}). Cancel for a full refund any time before it’s sent.</p>
            </div>
          )}
        </div>
        )}

        {!isPickup && (
          <CartSection title="Delivery area" subtitle="Pick the active state, city and exact area you want us to deliver to.">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs text-white/45">State</span>
                <select
                  value={selectedState}
                  onChange={(e) => {
                    setSelectedState(e.target.value)
                    setSelectedCityId('')
                    setSelectedZoneId('')
                    setAddr({ lodge: '', block: '', room: '', landmark: '' })
                    setCoords(null)
                  }}
                  className="lx-field w-full px-3.5 py-3 text-sm outline-none"
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="">Choose a state</option>
                  {stateOptions.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs text-white/45">City</span>
                <select
                  value={selectedCityId}
                  onChange={(e) => {
                    setSelectedCityId(e.target.value)
                    setSelectedZoneId('')
                    setAddr({ lodge: '', block: '', room: '', landmark: '' })
                    setCoords(null)
                  }}
                  className="lx-field w-full px-3.5 py-3 text-sm outline-none"
                  style={{ colorScheme: 'dark' }}
                  disabled={cityOptions.length === 0}
                >
                  <option value="">{selectedState ? 'Choose a city' : 'Choose a state first'}</option>
                  {cityOptions.map((city) => <option key={city.city_id} value={city.city_id}>{city.city_name}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs text-white/45">Area</span>
                <select
                  value={selectedZoneId}
                  onChange={(e) => {
                    setSelectedZoneId(e.target.value)
                    setAddr({ lodge: '', block: '', room: '', landmark: '' })
                    setCoords(null)
                  }}
                  className="lx-field w-full px-3.5 py-3 text-sm outline-none"
                  style={{ colorScheme: 'dark' }}
                  disabled={zoneOptions.length === 0}
                >
                  <option value="">{selectedCity ? 'Choose an area' : 'Choose a city first'}</option>
                  {zoneOptions.map((zone) => <option key={zone.zone_id} value={zone.zone_id}>{zone.zone_name}</option>)}
                </select>
              </label>
            </div>
            {selectedZone && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                <p className="font-medium text-white/85">{selectedCity?.city_name}, {selectedState} · {selectedZone.zone_name}</p>
                <p className="mt-1">Bike: {formatPrice(selectedZone.base_bike_fee_kobo)} · Door: {formatPrice(selectedZone.base_door_fee_kobo)} · Platform fee: {formatPrice(selectedZone.platform_markup_kobo)}</p>
              </div>
            )}
          </CartSection>
        )}

        {!isPickup && (
          <CartSection title="Drop-off details" subtitle={showLodgeCatalog ? 'Pick the lodge from the list, or type it if it is missing.' : 'Type the exact place, street, gate or landmark where the rider should bring it.'}>
            <DeliveryAddress
              deliveryType={deliveryType as 'BIKE' | 'DOOR'}
              value={addr}
              onChange={setAddr}
              suggestions={addressSuggestions}
              lodges={locationLodges}
              onCoords={setCoords}
              placeLabel={showLodgeCatalog ? 'lodge or hostel' : 'street, estate, school gate or landmark'}
              manualPlaceholder={showLodgeCatalog ? undefined : 'Type the street, estate, school gate or closest landmark'}
              catalogHint={showLodgeCatalog ? 'Choose your lodge from the list. If it is missing, switch to manual entry and type it yourself.' : undefined}
            />

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Special instructions <span className="text-white/30">(optional)</span>
              </label>
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 200))}
                placeholder="Any special requests for the vendor..." rows={2}
                className="lx-field w-full px-4 py-3 text-sm outline-none resize-none" />
              <p className="text-xs text-white/30 mt-1 text-right">{instructions.length}/200</p>
            </div>
          </CartSection>
        )}

        {!isPickup && (
          <CartSection title="Delivery extras" subtitle="Optional touches for the rider and delivery timing.">
            <div>
              <h3 className="text-sm font-medium text-white/70 mb-3">Add a tip</h3>
              <div className="flex gap-2">
                {TIP_OPTIONS.map((t) => (
                  <button key={t} onClick={() => setTip(t)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{
                      background: tip === t ? '#F5A623' : '#111113',
                      color: tip === t ? '#000' : 'rgba(255,255,255,0.7)',
                      border: `1px solid ${tip === t ? '#F5A623' : 'rgba(255,255,255,0.07)'}`,
                    }}>
                    {t === 0 ? '₦0' : formatPrice(t)}
                  </button>
                ))}
              </div>
            </div>
          </CartSection>
        )}

        {/* ── Payment method: Wallet vs Paystack (always a clear choice) ── */}
        {/* The whole selector shows regardless of the wallet flag; only the WALLET
            row is gated on it, so Paystack is never hidden (card must always work). */}
        {!walletLoading && (
          <CartSection title="Checkout" subtitle="Pick how you want to pay and confirm the final breakdown.">
            <div className="glass-thin overflow-hidden rounded-2xl">
              {/* Wallet choice — only when the customer wallet feature is enabled */}
              {features.customer_wallet_enabled === true && (
              <>
              <button
                onClick={() => { if (walletUsable) setPaymentMethod('WALLET'); else router.push('/profile/wallet') }}
                disabled={walletFrozen}
                className="w-full px-4 py-4 flex items-start gap-3 text-left disabled:opacity-50"
              >
                <div className="mt-0.5">
                  <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: paymentMethod === 'WALLET' && walletUsable ? '#F5A623' : 'rgba(255,255,255,0.3)',
                      background:  paymentMethod === 'WALLET' && walletUsable ? '#F5A623' : 'transparent',
                    }}>
                    {paymentMethod === 'WALLET' && walletUsable && <div className="w-2 h-2 rounded-full bg-black" />}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm flex items-center gap-1.5">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
                      LumeX Wallet
                    </span>
                    {walletUsable && <span className="lx-card-amber lx-amber text-xs px-1.5 py-0.5 rounded font-medium">Faster</span>}
                  </div>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {walletFrozen ? 'Wallet frozen — contact support'
                      : walletBalance === null ? 'Balance unavailable'
                      : `Balance: ${formatPrice(walletBalance)}`}
                  </p>
                </div>
              </button>

              {/* Wallet selected: cover breakdown */}
              {paymentMethod === 'WALLET' && walletUsable && (
                <div className="px-4 pb-4">
                  {walletCoversAll ? (
                    <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.15)' }}>
                      <div className="flex justify-between mb-1"><span className="text-white/60">Wallet covers</span><span className="text-green-400 font-medium">Full amount</span></div>
                      <div className="flex justify-between pt-2 border-t border-white/8"><span className="text-white/60">Balance after</span><span className="font-semibold">{formatPrice(walletBalance! - total)}</span></div>
                    </div>
                  ) : (
                    <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.15)' }}>
                      <div className="flex justify-between mb-1"><span className="text-white/60">From wallet</span><span className="font-medium text-amber-400">{formatPrice(walletAmount)}</span></div>
                      <div className="flex justify-between mb-2"><span className="text-white/60">Rest via Paystack</span><span className="font-semibold">{formatPrice(paystackAmount)}</span></div>
                      <button type="button" onClick={() => router.push('/profile/wallet')} className="lx-amber text-xs font-medium">
                        Top up {formatPrice(topUpNeeded)} to pay fully from wallet →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Empty wallet: prompt to top up */}
              {!walletUsable && !walletFrozen && (
                <div className="px-4 pb-4 -mt-2">
                  <button type="button" onClick={() => router.push('/profile/wallet')} className="lx-amber text-xs font-medium">
                    Top up to pay with wallet + get {fees?.bonus ?? 1}% bonus →
                  </button>
                </div>
              )}
              </>
              )}

              {/* Paystack choice */}
              <div className="border-t border-white/5">
                <button onClick={() => setPaymentMethod('PAYSTACK')} className="w-full px-4 py-4 flex items-center gap-3 text-left">
                  <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: effectivePaymentMethod === 'PAYSTACK' ? '#F5A623' : 'rgba(255,255,255,0.3)',
                      background:  effectivePaymentMethod === 'PAYSTACK' ? '#F5A623' : 'transparent',
                    }}>
                    {effectivePaymentMethod === 'PAYSTACK' && <div className="w-2 h-2 rounded-full bg-black" />}
                  </div>
                  <div>
                    <p className="font-medium text-sm flex items-center gap-1.5">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                      Card / Transfer / USSD
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>Pay with Paystack</p>
                  </div>
                </button>
              </div>
            </div>

        {/* Order summary */}
        <div className="glass-thin rounded-2xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Subtotal</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setFeeInfo((v) => !v)}
              aria-expanded={feeInfo}
              className="flex justify-between text-sm w-full text-left transition-opacity active:opacity-60"
            >
              <span className="text-white/60 inline-flex items-center gap-1.5">
                Platform fee
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/35" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
              </span>
              <span>{formatPrice(platformMarkup)}</span>
            </button>
            {feeInfo && (
              <p className="text-xs text-white/45 mt-1.5 leading-relaxed lx-enter">
                {isPickup
                  ? <>A flat <span className="text-white/70 font-medium">{formatPrice(platformMarkup)}</span>, same as delivery — but you skip the queue and there’s <span className="text-white/70 font-medium">no delivery fee</span>. 🛍️</>
                  : <>That’s <span className="text-white/70 font-medium">{platformMarkup.toLocaleString('en-NG')} kobo</span> 😅 — relax, just <span className="text-white/70 font-medium">{formatPrice(platformMarkup)}</span>, flat. Never a percentage. It runs your live tracking, reliable riders and real support. 🧡</>}
              </p>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => setDeliveryInfo((v) => !v)}
              aria-expanded={deliveryInfo}
              className="flex justify-between text-sm w-full text-left transition-opacity active:opacity-60"
            >
              <span className="text-white/60 inline-flex items-center gap-1.5">
                {isPickup ? 'Delivery (pickup)' : `Delivery (${deliveryType.toLowerCase()})`}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/35" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
              </span>
              <span>{isPickup ? 'Free' : formatPrice(deliveryFee)}</span>
            </button>
            {deliveryInfo && (
              <p className="text-xs text-white/45 mt-1.5 leading-relaxed lx-enter">
                {isPickup
                  ? 'You’re collecting in person, so there’s no rider and no delivery fee. 🛍️'
                  : 'Almost all of this goes straight to your rider — the person braving sun and traffic to reach your door. Worth every naira. 🛵'}
              </p>
            )}
          </div>
          {!isPickup && tip > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Tip</span>
              <span>{formatPrice(tip)}</span>
            </div>
          )}
          {paymentMethod !== 'PAYSTACK' && walletBalance !== null && walletBalance > 0 && (
            <>
              <div className="flex justify-between text-sm pt-2 border-t border-white/8">
                <span className="text-white/60">From wallet</span>
                <span className="text-green-400">-{formatPrice(walletAmount)}</span>
              </div>
              {!walletCoversAll && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Remaining (Paystack)</span>
                  <span>{formatPrice(paystackAmount)}</span>
                </div>
              )}
            </>
          )}
          <div className="flex justify-between font-semibold text-base pt-2 border-t border-white/8 mt-2">
            <span>Total</span>
            {/* key={total} remounts on change so the bump replays each recalculation */}
            <span key={total} className="lx-amber lx-bump">{formatPrice(total)}</span>
          </div>
        </div>

        {/* Saved rewards — customer chooses whether to spend them now or later. */}
        <CartRewardHint checked={applyReward} onChange={setApplyReward} />

        {/* Delivery acceptance — explicit agreement to Terms + Refund policy, gates Pay */}
        {!isPickup && (
          <label className="flex items-start gap-2.5 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={orderAgree}
              onChange={(e) => { setOrderAgree(e.target.checked); if (e.target.checked) setError('') }}
              className="mt-0.5 w-4 h-4 shrink-0 accent-amber-400"
            />
            <span className="text-xs text-white/60 leading-relaxed">
              I agree to the <a href="/terms" target="_blank" className="text-[#F5A623]">Terms</a> and{' '}
              <a href="/refunds" target="_blank" className="text-[#F5A623]">Refund &amp; Cancellation Policy</a>. I can cancel for a full refund before the vendor accepts; once accepted it can’t be cancelled. I can report a problem within 24 hours of delivery.
            </span>
          </label>
        )}
          </CartSection>
        )}

        {reorderNote && (
          <div className="lx-card-amber lx-amber rounded-xl p-3 text-sm">
            {reorderNote}
          </div>
        )}

        {error && (
          <div className="rounded-xl p-3 text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Fixed pay button — sits clear of the bottom nav (64px) AND the device
          safe-area inset so the home indicator never clips it. */}
      <div className="fixed left-0 right-0 z-40 px-4 pb-2" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleCheckout}
            disabled={loading || (isPickup && !pickupAgree) || (!isPickup && !orderAgree)}
            className="lx-btn-amber w-full py-4 text-base"
            style={{ minHeight: 56, borderRadius: 16 }}
          >
            {loading ? 'Processing…' : (
              (!isPickup && scheduleOn ? '🗓️ Schedule · ' : '') + (
                effectivePaymentMethod === 'WALLET'
                  ? `Pay ${formatPrice(total)} from Wallet`
                  : effectivePaymentMethod === 'SPLIT'
                    ? `Pay ${formatPrice(paystackAmount)} + Wallet ${formatPrice(walletAmount)}`
                    : `Pay ${formatPrice(total)}`
              )
            )}
          </button>
        </div>
      </div>

      <BottomNav />
    </main>
  )
}
