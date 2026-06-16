'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCart, cartLineKey, type CartItem } from './cart-context'
import { formatPrice } from '@/lib/money'

interface Suggestion {
  menu_item_id: string
  vendor_id: string
  vendor: string
  name: string
  price_kobo: number
}
interface DraftLine { menu_item_id: string; name: string; quantity: number; price_kobo: number; line_kobo: number }
interface OrderDraft {
  vendor_id: string
  vendor_name: string
  delivery_type: 'BIKE' | 'DOOR'
  delivery_address: string
  items: DraftLine[]
  subtotal_kobo: number
  markup_kobo: number
  delivery_fee_kobo: number
  total_kobo: number
}
interface Msg { role: 'user' | 'assistant'; content: string; suggestions?: Suggestion[]; draft?: OrderDraft; image?: string }
interface PendingImg { dataUrl: string; media_type: string; base64: string }

const AMBER = '#F5A623'
const AMBER_GRADIENT = 'linear-gradient(135deg, #FFB84D 0%, #F5A623 45%, #E8841A 100%)'

const GREETING: Msg = {
  role: 'assistant',
  content: "Hey, I'm Lumi 👋 your food buddy on campus. Tell me your budget and what you're feeling — I'll find real food and can place the whole order for you, right here.",
}

const QUICK = ['₦4,000, something filling', 'Order jollof to my hostel', 'Cheapest hot meal', 'Surprise me 🎲']

// ── Branded marks (SVG, not emoji — reads as a product, not a toy) ───────────
function LumiMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5l1.9 4.4 4.7.4-3.6 3.1 1.1 4.6L12 16.6 7.9 15l1.1-4.6L5.4 7.3l4.7-.4L12 2.5z" fill="#1a1205" opacity="0.92" />
      <circle cx="18.5" cy="6" r="1.6" fill="#1a1205" opacity="0.55" />
    </svg>
  )
}

export function Lumi() {
  const router = useRouter()
  const { addItem } = useCart()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [pendingImg, setPendingImg] = useState<PendingImg | null>(null)
  const [placing, setPlacing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

  function pickImage(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Photo must be JPG, PNG or WebP 🙏' }]); return
    }
    if (file.size > 3 * 1024 * 1024) {
      setMsgs((m) => [...m, { role: 'assistant', content: 'That photo is too big (max 3MB). Try a smaller one.' }]); return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setPendingImg({ dataUrl, media_type: file.type, base64: dataUrl.split(',')[1] ?? '' })
    }
    reader.readAsDataURL(file)
  }

  async function send(text: string) {
    const clean = text.trim()
    if ((!clean && !pendingImg) || loading) return
    const img = pendingImg
    const next: Msg[] = [...msgs, { role: 'user', content: clean, image: img?.dataUrl }]
    setMsgs(next)
    setInput('')
    setPendingImg(null)
    setLoading(true)
    try {
      const res = await fetch('/api/chow-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          image: img ? { media_type: img.media_type, data: img.base64 } : undefined,
        }),
      })
      const d = await res.json() as { reply?: string; suggestions?: Suggestion[]; order_draft?: OrderDraft; error?: string }
      if (!res.ok) { setMsgs((m) => [...m, { role: 'assistant', content: d.error ?? 'Something went wrong. Try again.' }]); return }
      setMsgs((m) => [...m, { role: 'assistant', content: d.reply ?? '', suggestions: d.suggestions, draft: d.order_draft }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error 😅 please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function addSuggestion(s: Suggestion) {
    const item: CartItem = {
      id: cartLineKey(s.menu_item_id, []),
      menu_item_id: s.menu_item_id,
      name: s.name,
      price_kobo: s.price_kobo,
      quantity: 1,
      addons: [],
    }
    const ok = addItem(s.vendor_id, s.vendor, item)
    if (ok) {
      setAdded((a) => ({ ...a, [s.menu_item_id]: true }))
    } else {
      setMsgs((m) => [...m, { role: 'assistant', content: `You already have items from another vendor in your cart. Clear it first to add ${s.name} from ${s.vendor}.` }])
    }
  }

  // Confirm & Pay: the student is paying for their OWN order. We post the draft
  // to /api/orders, which recomputes every figure server-side and opens the
  // Paystack charge — Lumi never moves money on its own.
  async function confirmOrder(draft: OrderDraft) {
    if (placing) return
    setPlacing(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: draft.vendor_id,
          items: draft.items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity, addons: [] })),
          delivery_type: draft.delivery_type,
          delivery_address: draft.delivery_address,
          tip_amount: 0,
          payment_method: 'PAYSTACK',
          wallet_amount_kobo: 0,
        }),
      })
      const data = await res.json() as { error?: string; authorization_url?: string; order_number?: string }
      if (!res.ok) {
        if (res.status === 401) { router.push('/auth?next=/home'); return }
        setMsgs((m) => [...m, { role: 'assistant', content: data.error ?? 'Could not place that order. Please try again.' }])
        return
      }
      if (data.authorization_url) { window.location.assign(data.authorization_url); return }
      if (data.order_number) { router.push(`/order/${data.order_number}`); return }
      setMsgs((m) => [...m, { role: 'assistant', content: 'Could not complete checkout. Please try again.' }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error 😅 please try again.' }])
    } finally {
      setPlacing(false)
    }
  }

  return (
    <>
      {/* ── Floating launcher ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full active:scale-95 transition-transform"
          style={{
            background: 'rgba(20,20,22,0.72)',
            border: '1px solid rgba(245,166,35,0.35)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 10px 34px rgba(245,166,35,0.28), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
          aria-label="Ask Lumi"
        >
          <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: AMBER_GRADIENT }}>
            <LumiMark size={17} />
          </span>
          <span className="text-sm font-semibold text-white">Ask Lumi</span>
        </button>
      )}

      {/* ── Chat sheet ── */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg flex flex-col lx-enter"
            style={{
              background: 'linear-gradient(180deg, #16161A 0%, #0E0E10 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderBottom: 'none',
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              height: '88dvh',
              maxHeight: '88dvh',
              boxShadow: '0 -20px 60px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber */}
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="w-9 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
            </div>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="relative">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: AMBER_GRADIENT, boxShadow: '0 4px 14px rgba(245,166,35,0.35)' }}>
                  <LumiMark size={20} />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{ background: '#34d399', borderColor: '#16161A' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px] leading-tight">Lumi</p>
                <p className="text-[11px] text-white/45 leading-tight mt-0.5">Your campus food buddy · online</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors active:scale-90"
                style={{ background: 'rgba(255,255,255,0.06)' }}
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {msgs.map((m, i) => (
                <div key={i}>
                  <div className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.role === 'assistant' && (
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mb-0.5" style={{ background: AMBER_GRADIENT }}>
                        <LumiMark size={12} />
                      </span>
                    )}
                    <div
                      className="max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed"
                      style={m.role === 'user'
                        ? { background: AMBER_GRADIENT, color: '#1a1205', borderRadius: 18, borderBottomRightRadius: 5, fontWeight: 500 }
                        : { background: 'rgba(255,255,255,0.055)', color: 'rgba(255,255,255,0.92)', borderRadius: 18, borderBottomLeftRadius: 5, border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.image && <img src={m.image} alt="" className="rounded-xl mb-1.5 max-h-40 w-auto" />}
                      {m.content}
                    </div>
                  </div>

                  {/* Suggestion cards (recommend → add to cart) */}
                  {m.suggestions && m.suggestions.length > 0 && (
                    <div className="mt-2.5 ml-8 space-y-2">
                      {m.suggestions.map((s) => (
                        <div key={s.menu_item_id} className="flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base" style={{ background: 'rgba(245,166,35,0.12)' }}>🍽️</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{s.name}</p>
                            <p className="text-xs text-white/45">{s.vendor} · <span style={{ color: AMBER }}>{formatPrice(s.price_kobo)}</span></p>
                          </div>
                          <button
                            onClick={() => addSuggestion(s)}
                            disabled={added[s.menu_item_id]}
                            className="shrink-0 text-xs font-semibold px-3.5 py-1.5 rounded-full disabled:opacity-60 active:scale-95 transition-transform"
                            style={{ background: added[s.menu_item_id] ? 'rgba(52,211,153,0.16)' : AMBER_GRADIENT, color: added[s.menu_item_id] ? '#34d399' : '#1a1205' }}
                          >
                            {added[s.menu_item_id] ? 'Added ✓' : 'Add'}
                          </button>
                        </div>
                      ))}
                      <a href="/cart" className="block text-center text-xs font-semibold py-2 rounded-xl" style={{ color: AMBER, background: 'rgba(245,166,35,0.08)' }}>View cart →</a>
                    </div>
                  )}

                  {/* Confirm & Pay card (concierge → straight to payment) */}
                  {m.draft && (
                    <div className="mt-2.5 ml-8 rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(245,166,35,0.28)', boxShadow: '0 8px 26px rgba(0,0,0,0.3)' }}>
                      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold tracking-widest" style={{ color: AMBER }}>YOUR ORDER</span>
                        <span className="text-[11px] text-white/45 truncate ml-2">{m.draft.vendor_name}</span>
                      </div>

                      <div className="px-4 space-y-1.5">
                        {m.draft.items.map((it) => (
                          <div key={it.menu_item_id} className="flex items-center justify-between text-sm">
                            <span className="text-white/85 truncate pr-2">{it.quantity}× {it.name}</span>
                            <span className="text-white/70 shrink-0 tabular-nums">{formatPrice(it.line_kobo)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="px-4 mt-2.5 text-xs text-white/55 flex items-start gap-1.5">
                        <span className="shrink-0">{m.draft.delivery_type === 'BIKE' ? '🛵' : '🚪'}</span>
                        <span>{m.draft.delivery_type === 'BIKE' ? 'Bike' : 'Door'} delivery to {m.draft.delivery_address}</span>
                      </div>

                      <div className="px-4 mt-3 pt-3 space-y-1.5 border-t text-sm" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                        <div className="flex justify-between text-white/55"><span>Subtotal</span><span className="tabular-nums">{formatPrice(m.draft.subtotal_kobo)}</span></div>
                        <div className="flex justify-between text-white/55"><span>Platform fee</span><span className="tabular-nums">{formatPrice(m.draft.markup_kobo)}</span></div>
                        <div className="flex justify-between text-white/55"><span>Delivery ({m.draft.delivery_type.toLowerCase()})</span><span className="tabular-nums">{formatPrice(m.draft.delivery_fee_kobo)}</span></div>
                        <div className="flex justify-between font-semibold pt-1.5 border-t mt-1.5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}><span>Total</span><span style={{ color: AMBER }} className="tabular-nums">{formatPrice(m.draft.total_kobo)}</span></div>
                      </div>

                      <div className="p-3 pt-3">
                        <button
                          onClick={() => confirmOrder(m.draft!)}
                          disabled={placing}
                          className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform disabled:opacity-60"
                          style={{ background: AMBER_GRADIENT, color: '#1a1205', minHeight: 48 }}
                        >
                          {placing ? 'Starting payment…' : `Confirm & Pay ${formatPrice(m.draft.total_kobo)}`}
                        </button>
                        <p className="text-[11px] text-white/35 text-center mt-2">Secure payment via Paystack · card, transfer or USSD</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex items-end gap-2 justify-start">
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: AMBER_GRADIENT }}>
                    <LumiMark size={12} />
                  </span>
                  <div className="px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.06)', borderBottomLeftRadius: 5 }}>
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/45 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/45 animate-bounce" style={{ animationDelay: '120ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/45 animate-bounce" style={{ animationDelay: '240ms' }} />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick chips (only before first user message) */}
            {msgs.length === 1 && (
              <div className="px-4 pb-1.5 flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <button key={q} onClick={() => send(q)} className="text-xs px-3 py-1.5 rounded-full transition-colors active:scale-95"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.72)', border: '1px solid rgba(255,255,255,0.07)' }}>{q}</button>
                ))}
              </div>
            )}

            {/* Pending photo preview */}
            {pendingImg && (
              <div className="px-3 pb-1 flex items-center gap-2">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pendingImg.dataUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                  <button onClick={() => setPendingImg(null)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white text-xs flex items-center justify-center border border-white/20">×</button>
                </div>
                <span className="text-xs text-white/40">Photo attached — describe it or just send</span>
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: 'rgba(255,255,255,0.07)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
              <label className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer shrink-0 active:scale-90 transition-transform" style={{ background: 'rgba(255,255,255,0.06)' }} aria-label="Add photo">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = '' }} />
              </label>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
                placeholder="Message Lumi…"
                className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none focus:border-amber-400/50 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              />
              <button
                onClick={() => send(input)}
                disabled={loading || (!input.trim() && !pendingImg)}
                className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform"
                style={{ background: AMBER_GRADIENT, color: '#1a1205' }}
                aria-label="Send"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
