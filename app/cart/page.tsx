'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart-context'
import { BottomNav } from '@/components/nav-bottom'
import { formatPrice } from '@/lib/money'
import { useFeatures } from '@/lib/use-features'

const TIP_OPTIONS = [0, 10000, 20000, 50000]

type PaymentMethod = 'PAYSTACK' | 'WALLET' | 'SPLIT'

export default function CartPage() {
  const router = useRouter()
  const { cart, setQuantity, clearCart, subtotal, totalItems } = useCart()
  const features = useFeatures()

  const [deliveryType,  setDeliveryType]  = useState<'BIKE' | 'DOOR'>('BIKE')
  const [address,       setAddress]       = useState('')
  const [instructions,  setInstructions]  = useState('')
  const [tip,           setTip]           = useState(0)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [fees,          setFees]          = useState<{ bike: number; door: number; markup: number } | null>(null)

  // ── Wallet state ──────────────────────────────────────────────────────────
  const [walletBalance,    setWalletBalance]    = useState<number | null>(null)
  const [walletLoading,    setWalletLoading]    = useState(true)
  const [paymentMethod,    setPaymentMethod]    = useState<PaymentMethod>('PAYSTACK')

  useEffect(() => {
    fetch('/api/settings/fees')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { bike_delivery_fee_kobo: number; door_delivery_fee_kobo: number; platform_markup_kobo: number } | null) => {
        if (d) setFees({ bike: d.bike_delivery_fee_kobo, door: d.door_delivery_fee_kobo, markup: d.platform_markup_kobo })
      })
      .catch(() => {})

    // Load customer wallet balance
    fetch('/api/customer-wallet/balance')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { balance_kobo: number; is_frozen: boolean } | null) => {
        if (d && !d.is_frozen && d.balance_kobo > 0) {
          setWalletBalance(d.balance_kobo)
        }
      })
      .catch(() => {})
      .finally(() => setWalletLoading(false))
  }, [])

  const deliveryFees    = fees ? { BIKE: fees.bike, DOOR: fees.door } : { BIKE: 50000, DOOR: 100000 }
  const platformMarkup  = fees?.markup ?? 25000
  const deliveryFee     = deliveryFees[deliveryType]
  const total           = subtotal + platformMarkup + deliveryFee + tip

  // ── Wallet payment math ────────────────────────────────────────────────────
  const walletCoversAll  = walletBalance !== null && walletBalance >= total
  const walletAmount     = walletBalance !== null ? Math.min(walletBalance, total) : 0
  const paystackAmount   = Math.max(0, total - walletAmount)

  const effectivePaymentMethod: PaymentMethod =
    paymentMethod === 'WALLET' && !walletCoversAll ? 'SPLIT' : paymentMethod

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

  async function handleCheckout() {
    if (!address.trim()) { setError('Please enter a delivery address'); return }
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
          delivery_address:      address,
          delivery_instructions: instructions || undefined,
          tip_amount:            tip,
          payment_method:        effectivePaymentMethod,
          wallet_amount_kobo:    effectivePaymentMethod !== 'PAYSTACK' ? walletAmount : 0,
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
        {/* Items */}
        <div className="glass-thin overflow-hidden">
          {cart.items.map((item, idx) => {
            const addonsKobo = item.addons.reduce((s, a) => s + a.price_kobo, 0)
            const eachKobo = item.price_kobo + addonsKobo
            return (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${idx < cart.items.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                {item.addons.length > 0 && (
                  <p className="text-xs text-white/40 mt-0.5 truncate">+ {item.addons.map((a) => a.name).join(', ')}</p>
                )}
                <p className="text-xs text-white/40 mt-0.5">{formatPrice(eachKobo)} each</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setQuantity(item.id, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
                  style={{ background: 'rgba(255,255,255,0.08)', minWidth: 32, minHeight: 32 }}>−</button>
                <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
                <button onClick={() => setQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
                  style={{ background: '#F5A623', color: '#000', minWidth: 32, minHeight: 32 }}>+</button>
              </div>
              <p className="text-sm font-semibold w-20 text-right shrink-0">{formatPrice(eachKobo * item.quantity)}</p>
            </div>
            )
          })}
        </div>

        {/* Delivery type */}
        <div>
          <h3 className="text-sm font-medium text-white/70 mb-3">Delivery type</h3>
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
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">Delivery address</label>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="Hall/hostel, room number..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:border-amber-400 transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Special instructions <span className="text-white/30">(optional)</span>
          </label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 200))}
            placeholder="Any special requests for the vendor..." rows={2}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none focus:border-amber-400 transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
          <p className="text-xs text-white/30 mt-1 text-right">{instructions.length}/200</p>
        </div>

        {/* Tip */}
        <div>
          <h3 className="text-sm font-medium text-white/70 mb-3">Add a tip (optional)</h3>
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

        {/* ── LumeX Wallet section ─────────────────────────────── */}
        {!walletLoading && features.wallet !== false && (
          <div className="glass-thin overflow-hidden">
            {walletBalance !== null && walletBalance > 0 ? (
              <>
                {/* Wallet option */}
                <button
                  onClick={() => setPaymentMethod(paymentMethod === 'PAYSTACK' ? 'WALLET' : 'PAYSTACK')}
                  className="w-full px-4 py-4 flex items-start gap-3 text-left"
                >
                  <div className="mt-0.5">
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{
                        borderColor: paymentMethod !== 'PAYSTACK' ? '#F5A623' : 'rgba(255,255,255,0.3)',
                        background:  paymentMethod !== 'PAYSTACK' ? '#F5A623' : 'transparent',
                      }}>
                      {paymentMethod !== 'PAYSTACK' && (
                        <div className="w-2 h-2 rounded-full bg-black" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm flex items-center gap-1.5">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
                        LumeX Wallet
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>Faster</span>
                    </div>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      Balance: {formatPrice(walletBalance)}
                    </p>
                  </div>
                </button>

                {/* Wallet cover breakdown (shown when wallet is selected) */}
                {paymentMethod !== 'PAYSTACK' && (
                  <div className="px-4 pb-4">
                    {walletCoversAll ? (
                      <div className="rounded-xl p-3 text-sm"
                        style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.15)' }}>
                        <div className="flex justify-between mb-1">
                          <span className="text-white/60">Order total</span>
                          <span className="font-medium">{formatPrice(total)}</span>
                        </div>
                        <div className="flex justify-between mb-1">
                          <span className="text-white/60">Wallet covers</span>
                          <span className="text-green-400 font-medium flex items-center gap-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                            Full amount
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-white/8">
                          <span className="text-white/60">Balance after</span>
                          <span className="font-semibold">{formatPrice(walletBalance - total)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl p-3 text-sm"
                        style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.15)' }}>
                        <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          Your wallet ({formatPrice(walletBalance)}) covers part of this order
                        </p>
                        <div className="flex justify-between mb-1">
                          <span className="text-white/60">From wallet</span>
                          <span className="font-medium text-amber-400">{formatPrice(walletAmount)}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-white/8">
                          <span className="text-white/60">Pay via Paystack</span>
                          <span className="font-semibold">{formatPrice(paystackAmount)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Divider + Paystack option */}
                <div className="border-t border-white/5">
                  <button
                    onClick={() => setPaymentMethod('PAYSTACK')}
                    className="w-full px-4 py-4 flex items-center gap-3 text-left"
                  >
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{
                        borderColor: paymentMethod === 'PAYSTACK' ? '#F5A623' : 'rgba(255,255,255,0.3)',
                        background:  paymentMethod === 'PAYSTACK' ? '#F5A623' : 'transparent',
                      }}>
                      {paymentMethod === 'PAYSTACK' && (
                        <div className="w-2 h-2 rounded-full bg-black" />
                      )}
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
              </>
            ) : (
              /* No wallet balance — subtle upsell */
              <button
                onClick={() => router.push('/profile/wallet')}
                className="w-full px-4 py-4 flex items-center justify-between text-left"
              >
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
                    LumeX Wallet
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Load money for faster checkout + 5% bonus →
                  </p>
                </div>
                <span className="text-white/30 text-sm">→</span>
              </button>
            )}
          </div>
        )}

        {/* Order summary */}
        <div className="glass-thin p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Subtotal</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Platform fee</span>
            <span>{formatPrice(platformMarkup)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Delivery ({deliveryType.toLowerCase()})</span>
            <span>{formatPrice(deliveryFee)}</span>
          </div>
          {tip > 0 && (
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
            <span style={{ color: '#F5A623' }}>{formatPrice(total)}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Fixed pay button */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-2">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleCheckout}
            disabled={loading}
            className="lx-btn-amber w-full py-4 text-base"
            style={{ minHeight: 56, borderRadius: 16 }}
          >
            {loading ? 'Processing…' : (
              effectivePaymentMethod === 'WALLET'
                ? `Pay ${formatPrice(total)} from Wallet`
                : effectivePaymentMethod === 'SPLIT'
                  ? `Pay ${formatPrice(paystackAmount)} + Wallet ${formatPrice(walletAmount)}`
                  : `Pay ${formatPrice(total)}`
            )}
          </button>
        </div>
      </div>

      <BottomNav />
    </main>
  )
}
