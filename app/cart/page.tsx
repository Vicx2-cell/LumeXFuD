'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { ArrowLeft, Timer, Users } from 'lucide-react'
import Image from 'next/image'
import { FOOD_BLUR } from '@/lib/blur'
import { useCart, type CartItem } from '@/components/cart-context'
import { BottomNav } from '@/components/nav-bottom'
import { formatPrice } from '@/lib/money'
import { useFeatures } from '@/lib/use-features'
import { estimateOrderPrepMinutes, prepRangeLabel } from '@/lib/prep-time'
import { formatHoursRange } from '@/lib/hours'
import { DeliveryAddress } from '@/components/delivery-address'
import { CartRewardHint } from '@/components/cart-reward-hint'
import { composeDeliveryAddress, type DeliveryAddressParts } from '@/lib/delivery-address'
import { getCampaignSessionId, trackCampaignEvent } from '@/lib/campaign-client'
import { recordFeedCommerceEvent } from '@/lib/feed/client-attribution'

const TIP_OPTIONS = [0, 10000, 20000, 50000]
const CHECKOUT_ATTEMPT_STORAGE_KEY = 'lumex_checkout_attempt_v1'

type PaymentMethod = 'PAYSTACK' | 'WALLET' | 'SPLIT'
type DeliveryEstimate = {
  distanceKm: number
  serviceFeeKobo: number
  deliveryFeeKobo: number
  activeSurchargeTotalKobo: number
}

type StoredCheckoutAttempt = { key: string; fingerprint: string }

declare global {
  interface Window {
    PaystackPop?: new () => { resumeTransaction: (accessCode: string) => void }
  }
}

function checkoutFingerprint(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}

function newCheckoutAttemptKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function CartSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-white/10 pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-white/90">{title}</h2>
        {subtitle && <p className="truncate text-xs text-white/40">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export default function CartPage() {
  const router = useRouter()
  const { cart, addItem, removeItem, setQuantity, setItemNotes, clearCart, subtotal, totalItems } = useCart()
  const features = useFeatures()
  const [groupBusy, setGroupBusy] = useState(false)

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
  const [estimate,      setEstimate]      = useState<DeliveryEstimate | null>(null)
  const [estimateError, setEstimateError] = useState('')
  const [hoursLabel,    setHoursLabel]    = useState('7am – 10pm') // live opening hours
  const [now]           = useState(() => Date.now())

  // ── Wallet state ──────────────────────────────────────────────────────────
  const [walletBalance,    setWalletBalance]    = useState<number | null>(null)
  const [walletFrozen,     setWalletFrozen]     = useState(false)
  const [walletLoading,    setWalletLoading]    = useState(features.customer_wallet_enabled !== true)
  const [paymentMethod,    setPaymentMethod]    = useState<PaymentMethod>('PAYSTACK')
  // GPS for this delivery (from "use my location" or a map/lodge pin). Cleared
  // when the address is hand-edited so coords never mismatch the text.
  const [coords,           setCoords]           = useState<{ lat: number; lng: number } | null>(null)
  const [gpsBusy,          setGpsBusy]          = useState(false)
  const [gpsMessage,       setGpsMessage]       = useState('')
  const [campaignId,       setCampaignId]       = useState('')
  const [promoCode,        setPromoCode]        = useState('')
  const [authChecked,      setAuthChecked]      = useState(false)
  const [isGuest,          setIsGuest]          = useState(false)
  const [guestName,        setGuestName]        = useState('')
  const [guestPhone,       setGuestPhone]       = useState('')
  const [removedLine,      setRemovedLine]      = useState<{ vendor_id: string; vendor_name: string; item: CartItem } | null>(null)
  const checkoutAttemptKeyRef = useRef<StoredCheckoutAttempt | null>(null)
  const checkoutSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [showStickyCheckout, setShowStickyCheckout] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { role?: string } | null) => setIsGuest(d?.role !== 'customer'))
      .catch(() => setIsGuest(true))
      .finally(() => setAuthChecked(true))

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

    // A stored location can still pre-fill the location name in checkout.
    try {
      const prefill = sessionStorage.getItem('lx_prefill_address')
      if (prefill) {
        sessionStorage.removeItem('lx_prefill_address')
        window.setTimeout(() => {
          setAddr((cur) => cur.lodge ? cur : { ...cur, lodge: prefill })
        }, 0)
      }
      const groupDeliveryType = sessionStorage.getItem('lx_group_delivery_type')
      if (groupDeliveryType === 'BIKE' || groupDeliveryType === 'DOOR' || groupDeliveryType === 'PICKUP') {
        sessionStorage.removeItem('lx_group_delivery_type')
        setDeliveryType(groupDeliveryType)
      }
    } catch { /* ignore */ }

    // Surface any items "Order again" had to drop (no longer on the menu).
    try {
      const skipped = sessionStorage.getItem('reorder_skipped')
      if (skipped) {
        sessionStorage.removeItem('reorder_skipped')
        window.setTimeout(() => {
          setReorderNote(`Some items were unavailable and left out: ${skipped}`)
        }, 0)
      }
      const campaign = sessionStorage.getItem('lx_campaign_id') ?? new URLSearchParams(window.location.search).get('campaign') ?? ''

      if (campaign) setCampaignId(campaign)
    } catch { /* ignore */ }
  }, [features.customer_wallet_enabled])

  useEffect(() => {
    const updateStickyCheckout = () => {
      const checkoutTop = checkoutSurfaceRef.current?.getBoundingClientRect().top
      // The inline action below consent takes over once checkout enters view.
      setShowStickyCheckout(checkoutTop === undefined || checkoutTop > window.innerHeight - 24)
    }

    updateStickyCheckout()
    window.addEventListener('scroll', updateStickyCheckout, { passive: true })
    window.addEventListener('resize', updateStickyCheckout)
    return () => {
      window.removeEventListener('scroll', updateStickyCheckout)
      window.removeEventListener('resize', updateStickyCheckout)
    }
  }, [walletLoading])

  useEffect(() => {
    if (deliveryType === 'PICKUP' || !coords || !cart.vendor_id) {

      setEstimate(null)
      setEstimateError('')
      return
    }

    let cancelled = false
    fetch('/api/orders/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_id: cart.vendor_id,
        delivery_type: deliveryType,
        delivery_latitude: coords.lat,
        delivery_longitude: coords.lng,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { error?: string; estimate?: { distanceKm: number; serviceFeeKobo: number; deliveryFeeKobo: number; activeSurchargeTotalKobo: number } } | null
        if (cancelled) return
        if (!response.ok || !data?.estimate) {
          setEstimate(null)
          setEstimateError(data?.error ?? 'Could not estimate delivery right now.')
          return
        }
        setEstimate(data.estimate)
        setEstimateError('')
      })
      .catch(() => {
        if (!cancelled) {
          setEstimate(null)
          setEstimateError('Could not estimate delivery right now.')
        }
      })

    return () => { cancelled = true }
  }, [cart.vendor_id, coords, deliveryType])

  const isPickup        = deliveryType === 'PICKUP'
  // Fold the structured parts into one rider-clear line ("Lodge · Block B · Room 12 · landmark").
  const composedAddress = isPickup ? '' : composeDeliveryAddress(deliveryType as 'BIKE' | 'DOOR', addr)
  // Pickup charges the SAME platform fee as delivery — just ₦0 delivery, no tip.
  const deliveryFee     = isPickup ? 0 : estimate?.deliveryFeeKobo ?? (deliveryType === 'BIKE'
    ? fees?.bike ?? 0
    : fees?.door ?? 0)
  const platformMarkup  = isPickup ? (fees?.markup ?? 0) : estimate?.serviceFeeKobo ?? fees?.markup ?? 0
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
  const scheduleMin = toLocalInput(new Date(now + 25 * 60_000))
  const scheduleMax = toLocalInput(new Date(now + 7 * 86_400_000))

  async function captureCurrentLocation() {
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
      setGpsBusy(false)
    }, () => {
      setGpsBusy(false)
      setGpsMessage('Could not get your location')
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 })
  }

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
          {removedLine && (
            <button
              type="button"
              onClick={undoRemove}
              className="mt-3 min-h-11 rounded-xl border border-white/10 bg-white/[0.06] px-5 text-sm font-semibold text-white/70"
            >
              Undo remove
            </button>
          )}
        </div>
        <BottomNav />
      </main>
    )
  }

  async function startGroupOrder() {
    if (!cart.vendor_id || cart.items.length === 0) return
    const groupAddress = deliveryType === 'PICKUP' ? `Pickup at ${cart.vendor_name}` : composedAddress
    if (!groupAddress) {
      setError('Add the group delivery destination before starting the group.')
      return
    }
    setGroupBusy(true); setError('')
    try {
      const res = await fetch('/api/group-order/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: cart.vendor_id,
          delivery_type: deliveryType,
          delivery_address: groupAddress,
          items: cart.items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity, notes: i.special_instructions, addons: i.addons.map((addon) => addon.id) })),
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not start group order.'); return }
      router.push(`/group/${d.code}`)
    } catch { setError('Connection error.') } finally { setGroupBusy(false) }
  }

  function removeCartLine(item: CartItem) {
    if (cart.vendor_id && cart.vendor_name) {
      setRemovedLine({ vendor_id: cart.vendor_id, vendor_name: cart.vendor_name, item })
    }
    removeItem(item.id)
    window.setTimeout(() => {
      setRemovedLine((current) => current?.item.id === item.id ? null : current)
    }, 7000)
  }

  function undoRemove() {
    if (!removedLine) return
    addItem(removedLine.vendor_id, removedLine.vendor_name, removedLine.item)
    setRemovedLine(null)
  }

  function resolveCheckoutAttemptKey(fingerprint: string): string {
    if (checkoutAttemptKeyRef.current?.fingerprint === fingerprint) return checkoutAttemptKeyRef.current.key
    try {
      const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) ?? 'null') as StoredCheckoutAttempt | null
      if (stored?.key && stored.fingerprint === fingerprint) {
        checkoutAttemptKeyRef.current = stored
        return stored.key
      }
    } catch { /* A malformed browser value must never block checkout. */ }

    const key = newCheckoutAttemptKey()
    const attempt = { key, fingerprint }
    checkoutAttemptKeyRef.current = attempt
    try { sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt)) } catch { /* storage can be unavailable */ }
    return key
  }

  function clearCheckoutAttempt() {
    checkoutAttemptKeyRef.current = null
    try { sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY) } catch { /* storage can be unavailable */ }
  }

  async function handleCheckout() {
    if (loading) return // guard against double-submit before the disabled state paints
    if (!isPickup) {
      if (!addr.lodge.trim()) {
        setError('Please type the location name')
        return
      }
      if (composedAddress.trim().length < 5) { setError('Please give a clearer delivery location'); return }
      if (!coords) { setError('Pin your current location before placing a delivery order'); return }
      if (estimateError) { setError(estimateError); return }
    }
    if (!isPickup && scheduleOn && !scheduleAt) { setError('Pick a date and time for your scheduled order'); return }
    if (isPickup && !pickupAgree) { setError('Please accept the pickup collection terms to continue'); return }
    if (!isPickup && !orderAgree) { setError('Please accept the Terms and Refund Policy to continue'); return }
    if (authChecked && isGuest) {
      if (guestName.trim().length < 2) { setError('Enter your name for the order'); return }
      if (guestPhone.trim().length < 7) { setError('Enter your WhatsApp phone number'); return }
    }
    setError(''); setLoading(true)
    const attemptFingerprint = checkoutFingerprint({
      vendorId: cart.vendor_id,
      items: cart.items.map((item) => ({ id: item.id, menuItemId: item.menu_item_id, quantity: item.quantity, notes: item.special_instructions, addons: item.addons.map((addon) => addon.id).sort() })),
      deliveryType, address: isPickup ? null : composedAddress, coords: isPickup ? null : coords,
      instructions, tip, paymentMethod: effectivePaymentMethod, walletAmount, applyReward,
      scheduledFor: scheduleOn ? scheduleAt : null, guestName: authChecked && isGuest ? guestName.trim() : null,
      guestPhone: authChecked && isGuest ? guestPhone.trim() : null,
      promoCode: promoCode.trim().toUpperCase() || null,
    })
    const attemptKey = resolveCheckoutAttemptKey(attemptFingerprint)
    if (campaignId && cart.vendor_id) {
      trackCampaignEvent({
        campaignId,
        vendorId: cart.vendor_id,
        eventType: 'checkout_started',
        source: 'checkout',
        placement: 'cart_checkout_button',
        targetType: 'order',
        targetId: cart.vendor_id,
        sessionId: getCampaignSessionId(),
        metadata: { delivery_type: deliveryType, total },
      })
    }
    void recordFeedCommerceEvent('checkout_start', cart.vendor_id)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': attemptKey,
        },
        body: JSON.stringify({
          vendor_id:             cart.vendor_id,
          guest_name:            authChecked && isGuest ? guestName.trim() : undefined,
          guest_phone:           authChecked && isGuest ? guestPhone.trim() : undefined,
          guest_terms_accepted:  authChecked && isGuest ? orderAgree : undefined,
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
          // Structured parts stored alongside the string (rider sees them as chips).
          delivery_lodge:        isPickup ? undefined : addr.lodge.trim() || undefined,
          delivery_instructions: instructions || undefined,
          tip_amount:            isPickup ? 0 : tip,
          payment_method:        effectivePaymentMethod,
          wallet_amount_kobo:    effectivePaymentMethod !== 'PAYSTACK' ? walletAmount : 0,
          apply_reward:          applyReward,
          promo_code:            promoCode.trim().toUpperCase() || undefined,
          scheduled_for:         !isPickup && scheduleOn && scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
          delivery_latitude:     isPickup ? undefined : coords?.lat,
          delivery_longitude:    isPickup ? undefined : coords?.lng,
          // Set when this cart was handed over from a group order (host checkout).
          group_order_id:        isPickup ? undefined : (() => { try { return sessionStorage.getItem('lx_group_id') || undefined } catch { return undefined } })(),
          // Binding consent for the 1h25m pickup agreement (Invariant I8).
          pickup_agreement:      isPickup ? pickupAgree : undefined,
          // Optional leave-at-gate for delivery (only when the handover flag is on).
          leave_at_gate:         !isPickup && features.delivery_handover_v1 === true ? leaveAtGate : undefined,
          campaign_id:           campaignId || undefined,
        }),
      })

      const data = await res.json() as {
        error?: string
        authorization_url?: string
        access_code?: string
        order_number?: string
        order_id?: string
      }

      if (!res.ok) {
        // A conflict or server/network failure may mean the original request
        // reached the server. Keep its key so retry/reload resumes safely.
        if (res.status >= 400 && res.status < 500 && res.status !== 409) clearCheckoutAttempt()
        if (res.status === 401) { router.push('/auth?next=/cart'); return }
        setError(data.error ?? (res.status >= 500 ? 'We could not start your order. Your cart is still saved; please retry.' : 'Failed to create order'))
        return
      }

      clearCheckoutAttempt()
      clearCart()
      try { sessionStorage.removeItem('lx_group_id') } catch { /* ignore */ }

      // Trust the server's resolved split, not the client's guess: it recomputes
      // wallet coverage from the live balance and may downgrade WALLET→SPLIT if
      // the balance dropped. A Paystack URL means there's still an amount to pay;
      // its absence means the wallet covered the whole order.
      if (data.authorization_url) {
        if (!data.access_code || !window.PaystackPop) {
          setError('Secure payment is loading. Please refresh and try again.')
          return
        }
        new window.PaystackPop().resumeTransaction(data.access_code)
        return
      }
      if (data.order_number) {
        router.push(campaignId ? `/order/${data.order_number}?campaign=${encodeURIComponent(campaignId)}` : `/order/${data.order_number}`)
        return
      }
      setError('Could not complete checkout. Please try again.')
    } catch {
      setError('Network error. Your cart is still saved; please retry.')
    } finally {
      setLoading(false)
    }
  }

  const checkoutDisabled = loading || (isPickup && !pickupAgree) || (!isPickup && !orderAgree)
  const checkoutLabel = loading ? 'Processing...' : (
    (!isPickup && scheduleOn ? 'Schedule - ' : '') + (
      effectivePaymentMethod === 'WALLET'
        ? `Pay ${formatPrice(total)} from Wallet`
        : effectivePaymentMethod === 'SPLIT'
          ? `Pay ${formatPrice(paystackAmount)} + Wallet ${formatPrice(walletAmount)}`
          : `Pay ${formatPrice(total)}`
    )
  )
  const checkoutAction = () => (
    <button
      onClick={handleCheckout}
      disabled={checkoutDisabled}
      className="lx-btn-amber w-full py-4 text-base"
      style={{ minHeight: 56, borderRadius: 16 }}
    >
      {checkoutLabel}
    </button>
  )

  return (
    <main className="lx-page pb-48 overflow-hidden">
      <Script src="https://js.paystack.co/v2/inline.js" strategy="afterInteractive" />
      {/* Header */}
      <div className="sticky top-0 z-40 glass-thin px-4 py-3" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button type="button" onClick={() => router.back()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--lx-border)] bg-[var(--lx-surface)] text-[var(--lx-text-muted)] transition-transform hover:text-[var(--lx-text)] active:scale-90" aria-label="Go back">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div>
            <h1 className="font-semibold">Cart</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:px-6 lx-enter">
        {/* Estimated time — longest dish + delivery window */}
        <div className="flex items-center gap-2.5 border-b border-white/10 pb-4">
          <Timer size={18} className="lx-amber shrink-0" aria-hidden="true" />
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
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-[#F5A623]/30 px-3 text-sm font-semibold text-[#F5A623] disabled:opacity-50"
          >
            <Users size={17} aria-hidden="true" />
            {groupBusy ? 'Starting…' : 'Order with friends (split one delivery)'}
          </button>
        )}

        {!isPickup && (
          <CartSection title="GPS" subtitle="Pin your current location before you type the place name.">
            <button
              type="button"
              onClick={() => void captureCurrentLocation()}
              disabled={gpsBusy}
              className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50"
            >
              {gpsBusy ? 'Getting location…' : 'Use current location'}
            </button>
            {coords && (
              <p className="text-xs text-white/40">
                Active GPS: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            )}
            {gpsMessage && <p className="text-xs text-white/45">{gpsMessage}</p>}
            {estimateError && <p className="text-xs text-red-400">{estimateError}</p>}
          </CartSection>
        )}

        <CartSection title="Your items" subtitle={`${totalItems} item${totalItems === 1 ? '' : 's'} from ${cart.vendor_name}`}>
        <div className="overflow-hidden border-y border-white/10">
          {cart.items.map((item, idx) => {
            const addonsKobo = item.addons.reduce((s, a) => s + a.price_kobo, 0)
            const eachKobo = item.price_kobo + addonsKobo
            return (
            <div key={item.id} className={`grid grid-cols-[48px_1fr] gap-3 px-3 py-3 sm:grid-cols-[56px_1fr_auto] sm:px-4 ${idx < cart.items.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-white/8 bg-white/5 sm:h-14 sm:w-14">
                {item.image_url ? (
                  <Image src={item.image_url} alt="" fill sizes="56px" className="object-cover" placeholder="blur" blurDataURL={FOOD_BLUR} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium leading-snug">{item.name}</p>
                {item.addons.length > 0 && (
                  <p className="mt-0.5 break-words text-xs leading-snug text-white/40">+ {item.addons.map((a) => a.name).join(', ')}</p>
                )}
                <p className="text-xs text-white/40 mt-0.5">{formatPrice(eachKobo)} each</p>
                <label className="mt-2 block text-[11px] uppercase tracking-[0.14em] text-white/35" htmlFor={`notes-${item.id}`}>Item note</label>
                <textarea
                  id={`notes-${item.id}`}
                  value={item.special_instructions ?? ''}
                  onChange={(e) => setItemNotes(item.id, e.target.value.slice(0, 200))}
                  rows={2}
                  placeholder="Optional kitchen note"
                  className="lx-field mt-1 w-full resize-none px-3 py-2 text-xs outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => router.push(`/vendor/${cart.vendor_id}`)} className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/60">Edit</button>
                  <button type="button" onClick={() => removeCartLine(item)} className="min-h-10 rounded-lg border border-red-400/20 bg-red-500/10 px-3 text-xs font-semibold text-red-300">Remove</button>
                </div>
              </div>
              <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end">
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setQuantity(item.id, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
                  style={{ background: 'rgba(255,255,255,0.08)', minWidth: 44, minHeight: 44 }}>−</button>
                <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
                <button onClick={() => setQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
                  style={{ background: '#F5A623', color: '#000', minWidth: 44, minHeight: 44 }}>+</button>
              </div>
              <p className="text-sm font-semibold text-right shrink-0 tabular-nums">{formatPrice(eachKobo * item.quantity)}</p>
              </div>
            </div>
            )
          })}
        </div>
        {removedLine && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2">
            <p className="min-w-0 truncate text-xs text-white/55">Removed {removedLine.item.name}</p>
            <button type="button" onClick={undoRemove} className="min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold" style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>Undo</button>
          </div>
        )}
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
                <p className="text-xs text-white/55 mt-0.5 tabular-nums">{formatPrice(type === 'BIKE' ? (fees?.bike ?? 0) : (fees?.door ?? 0))}</p>
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
          <CartSection title="Drop-off details" subtitle="Pin your current location, then type the exact place name and any rider note.">
            <DeliveryAddress
              deliveryType={deliveryType as 'BIKE' | 'DOOR'}
              value={addr}
              onChange={setAddr}
              placeLabel="Location name"
              manualPlaceholder="Type the location name"
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
          <div ref={checkoutSurfaceRef}>
          <CartSection title="Checkout" subtitle="Pick how you want to pay and confirm the final breakdown.">
            <div className="mb-4">
              <label htmlFor="promo-code" className="mb-1 block text-xs font-medium text-white/55">Promotion code</label>
              <input id="promo-code" value={promoCode} onChange={(e) => setPromoCode(e.target.value.slice(0, 40).toUpperCase())}
                placeholder="Optional" className="lx-field w-full px-3 py-2.5 text-sm uppercase outline-none" autoComplete="off" />
              <p className="mt-1 text-xs text-white/35">Eligibility and the final discount are verified securely when you pay.</p>
            </div>
            {authChecked && isGuest && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="guest-name" className="mb-1 block text-xs font-medium text-white/55">Name</label>
                    <input id="guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value.slice(0, 80))} className="lx-field w-full px-3 py-2.5 text-sm outline-none" autoComplete="name" />
                  </div>
                  <div>
                    <label htmlFor="guest-phone" className="mb-1 block text-xs font-medium text-white/55">WhatsApp phone</label>
                    <input id="guest-phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value.slice(0, 20))} className="lx-field w-full px-3 py-2.5 text-sm outline-none" inputMode="tel" autoComplete="tel" />
                  </div>
                </div>
              </div>
            )}
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
          </CartSection>
          </div>
        )}

        {/* Order summary */}
        <div className="space-y-2 border-y border-white/10 py-4">
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
          {!isPickup && estimate && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Delivery distance</span>
                <span>{estimate.distanceKm.toFixed(2)} km</span>
              </div>
              {estimate.activeSurchargeTotalKobo > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Active surcharge</span>
                  <span>{formatPrice(estimate.activeSurchargeTotalKobo)}</span>
                </div>
              )}
            </>
          )}
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

        {!isPickup && (
          <CartSection title="Consent" subtitle="You need to accept the policy before checkout can continue.">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={orderAgree}
                onChange={(e) => { setOrderAgree(e.target.checked); if (e.target.checked) setError('') }}
                className="mt-0.5 w-4 h-4 shrink-0 accent-amber-400"
              />
              <span className="text-xs text-white/60 leading-relaxed">
                I agree to the <a href="/terms" target="_blank" className="text-[#F5A623]">Terms</a>, {' '}
                <a href="/privacy" target="_blank" className="text-[#F5A623]">Privacy Policy</a>, and {' '}
                <a href="/refunds" target="_blank" className="text-[#F5A623]">Refund &amp; Cancellation Policy</a>. I can cancel for a full refund before the vendor accepts; once accepted it can’t be cancelled. I can report a problem within 24 hours of delivery.
              </span>
            </label>
          </CartSection>
        )}

        <div className="pt-1">
          {checkoutAction()}
        </div>

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
      {showStickyCheckout && (
        <div className="fixed left-0 right-0 z-40 px-4 pb-2" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
          <div className="mx-auto max-w-3xl">{checkoutAction()}</div>
        </div>
      )}

      <BottomNav />
    </main>
  )
}
