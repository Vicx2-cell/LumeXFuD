'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart-context'
import { BottomNav } from '@/components/nav-bottom'
import { formatPrice } from '@/lib/money'

const TIP_OPTIONS = [0, 10000, 20000, 50000]

type PaymentMethod = 'PAYSTACK' | 'WALLET' | 'SPLIT'

export default function CartPage() {
  const router = useRouter()
  const { cart, setQuantity, clearCart, subtotal, totalItems } = useCart()

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
      <main className="min-h-dvh flex flex-col items-center justify-center pb-24 px-5" style={{ background: '#0A0A0B' }}>
        <p className="text-5xl mb-4">🛒</p>
        <h2 className="text-lg font-semibold">Your cart is empty</h2>
        <p className="text-sm text-white/40 mt-1">Add items from a vendor to get started</p>
        <button
          onClick={() => router.push('/')}
          className="mt-6 px-6 py-3 rounded-xl font-medium"
          style={{ background: '#F5A623', color: '#000' }}
        >
          Browse vendors
        </button>
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
            menu_item_id:          i.id,
            quantity:              i.quantity,
            special_instructions:  i.special_instructions,
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

      // WALLET: no Paystack popup needed — go straight to order page
      if (effectivePaymentMethod === 'WALLET' && data.order_number) {
        router.push(`/order/${data.order_number}`)
        return
      }

      // PAYSTACK or SPLIT: redirect to Paystack
      window.location.href = data.authorization_url!
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-dvh pb-32" style={{ background: '#0A0A0B' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
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

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        {/* Items */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
          {cart.items.map((item, idx) => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${idx < cart.items.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-xs text-white/40 mt-0.5">{formatPrice(item.price_kobo)} each</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setQuantity(item.id, item.quantity - 1)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold"
                  style={{ background: 'rgba(255,255,255,0.07)', minWidth: 32, minHeight: 32 }}>−</button>
                <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
                <button onClick={() => setQuantity(item.id, item.quantity + 1)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold"
                  style={{ background: '#F5A623', color: '#000', minWidth: 32, minHeight: 32 }}>+</button>
              </div>
              <p className="text-sm font-semibold w-20 text-right shrink-0">{formatPrice(item.price_kobo * item.quantity)}</p>
            </div>
          ))}
        </div>

        {/* Delivery type */}
        <div>
          <h3 className="text-sm font-medium text-white/70 mb-3">Delivery type</h3>
          <div className="grid grid-cols-2 gap-3">
            {(['BIKE', 'DOOR'] as const).map((type) => (
              <button key={type} onClick={() => setDeliveryType(type)}
                className="rounded-xl p-4 text-left"
                style={{
                  background: deliveryType === type ? 'rgba(245,166,35,0.1)' : '#111113',
                  border: `1px solid ${deliveryType === type ? '#F5A623' : 'rgba(255,255,255,0.07)'}`,
                }}>
                <div className="text-lg mb-1">{type === 'BIKE' ? '🏍️' : '🚪'}</div>
                <p className="text-sm font-semibold">{type === 'BIKE' ? 'Bike' : 'Door'}</p>
                <p className="text-xs text-white/50 mt-0.5">{formatPrice(deliveryFees[type])}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">Delivery address</label>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="Hall/hostel, room number..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }} />
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Special instructions <span className="text-white/30">(optional)</span>
          </label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 200))}
            placeholder="Any special requests for the vendor..." rows={2}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }} />
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
        {!walletLoading && (
          <div className="rounded-2xl overflow-hidden" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
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
                      <span className="font-medium text-sm">💰 LumeX Wallet</span>
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
                          <span className="text-green-400 font-medium">✅ Full amount</span>
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
                      <p className="font-medium text-sm">💳 Card / Transfer / USSD</p>
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
                  <p className="text-sm font-medium">💰 LumeX Wallet</p>
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
        <div className="rounded-2xl p-4 space-y-2" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
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
            className="w-full rounded-2xl py-4 font-semibold text-base disabled:opacity-50"
            style={{ background: '#F5A623', color: '#000', minHeight: 56 }}
          >
            {loading ? 'Processing…' : (
              effectivePaymentMethod === 'WALLET'
                ? `⚡ Pay ${formatPrice(total)} from Wallet`
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
