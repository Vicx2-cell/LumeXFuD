'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Send, X } from 'lucide-react'

type QuickReply = {
  id: string
  label: string
  value: string
}

type ChatMessage = {
  id: string
  from: 'user' | 'lumi'
  text: string
  quickReplies?: QuickReply[]
}

type LumiReply = {
  reply: string
  quickReplies?: QuickReply[]
}

type LumiConfirmPayload = {
  action: 'place_order' | 'fund_wallet' | 'cancel_order'
  requestBody?: Record<string, unknown>
  orderId?: string
}

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  from: 'lumi',
  text: 'Hi, I am Lumi. I can help you check your wallet, browse vendors, place an order, track an order, fund your wallet, or cancel an order.',
  quickReplies: [
    { id: 'check-balance', label: 'Check balance', value: 'check my balance' },
    { id: 'browse-vendors', label: 'Browse vendors', value: 'show vendors' },
    { id: 'order-food', label: 'Order food', value: 'i want food' },
    { id: 'fund-wallet', label: 'Fund wallet', value: 'fund my wallet' },
  ],
}

export default function LumiChat() {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  async function sendMessage(raw: string) {
    const message = raw.trim()
    if (!message || pending) return

    setError('')
    setPending(true)
    setMessages((current) => current.concat({ id: crypto.randomUUID(), from: 'user', text: message }))

    try {
      const res = await fetch('/api/lumi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json() as LumiReply & { error?: string }
      if (!res.ok) {
        throw new Error(data.error ?? data.reply ?? 'Could not reach Lumi.')
      }
      setMessages((current) => current.concat({
        id: crypto.randomUUID(),
        from: 'lumi',
        text: data.reply,
        quickReplies: data.quickReplies,
      }))
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach Lumi.')
    } finally {
      setPending(false)
    }
  }

  async function runConfirmationFlow() {
    setPending(true)
    setError('')
    try {
      const res = await fetch('/api/lumi/confirm', { method: 'POST' })
      const data = await res.json() as LumiConfirmPayload & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not continue that action.')

      if (data.action === 'place_order' && data.requestBody) {
        const orderRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data.requestBody),
        })
        const orderData = await orderRes.json() as { error?: string; authorization_url?: string; order_number?: string }
        if (!orderRes.ok) throw new Error(orderData.error ?? 'Could not place the order.')
        if (orderData.authorization_url) {
          window.location.assign(orderData.authorization_url)
          return
        }
        if (orderData.order_number) {
          router.push(`/order/${orderData.order_number}`)
          return
        }
        throw new Error('Checkout started, but no next step came back.')
      }

      if (data.action === 'fund_wallet' && data.requestBody) {
        const fundRes = await fetch('/api/customer-wallet/topup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data.requestBody),
        })
        const fundData = await fundRes.json() as { error?: string; authorization_url?: string }
        if (!fundRes.ok) throw new Error(fundData.error ?? 'Could not start the top-up.')
        if (fundData.authorization_url) {
          window.location.assign(fundData.authorization_url)
          return
        }
        throw new Error('Top-up started, but no payment link came back.')
      }

      if (data.action === 'cancel_order' && data.orderId) {
        const cancelRes = await fetch(`/api/orders/${data.orderId}/cancel`, { method: 'POST' })
        const cancelData = await cancelRes.json() as { error?: string }
        if (!cancelRes.ok) throw new Error(cancelData.error ?? 'Could not cancel the order.')
        setMessages((current) => current.concat({
          id: crypto.randomUUID(),
          from: 'lumi',
          text: 'Your order has been cancelled.',
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue that action.')
    } finally {
      setPending(false)
    }
  }

  async function handleQuickReply(reply: QuickReply) {
    if (pending) return
    if (reply.value.startsWith('/')) {
      router.push(reply.value)
      return
    }
    if (reply.value === 'confirm_order' || reply.value === 'confirm_funding' || reply.value === 'confirm_cancel_order') {
      await runConfirmationFlow()
      return
    }
    await sendMessage(reply.value)
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 text-black shadow-[0_14px_32px_rgba(0,0,0,0.3)] transition-transform active:scale-95"
          style={{ background: 'var(--color-amber)' }}
          aria-label="Open Lumi chat"
        >
          <MessageCircle size={18} strokeWidth={2.2} />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 px-0 sm:px-4 sm:py-4"
          style={{ backdropFilter: 'blur(6px)' }}
          onClick={() => !pending && setOpen(false)}
        >
          <section
            aria-label="Lumi chat"
            className="flex h-[86dvh] max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 sm:h-[78dvh] sm:rounded-3xl"
            style={{
              background: 'var(--lx-surface-solid)',
              boxShadow: '0 -16px 48px rgba(0,0,0,0.42)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center py-2 sm:hidden">
              <span className="h-1 w-10 rounded-full bg-white/15" />
            </div>

            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-black"
                style={{ background: 'var(--color-amber)' }}
              >
                <MessageCircle size={18} strokeWidth={2.1} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">Ask Lumi</p>
                <p className="mt-0.5 text-[11px] text-white/45">Help with orders, wallet, and delivery</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors active:scale-95 disabled:opacity-50"
                aria-label="Close Lumi chat"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </div>

            <div ref={scrollRef} data-lenis-prevent className="flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id}>
                    <div className={`flex gap-2 ${message.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {message.from === 'lumi' && (
                        <span
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black"
                          style={{ background: 'rgba(245,166,35,0.18)' }}
                        >
                          <MessageCircle size={12} strokeWidth={2.1} />
                        </span>
                      )}
                      <div
                        className={`max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                          message.from === 'user'
                            ? 'rounded-br-md text-black'
                            : 'rounded-bl-md border border-white/8 bg-white/5 text-white'
                        }`}
                        style={message.from === 'user' ? { background: 'var(--color-amber)' } : undefined}
                      >
                        {message.text}
                      </div>
                    </div>

                    {message.quickReplies && message.quickReplies.length > 0 && (
                      <div className="mt-2.5 ml-9 flex flex-wrap gap-2">
                        {message.quickReplies.map((reply) => (
                          <button
                            key={reply.id}
                            type="button"
                            onClick={() => handleQuickReply(reply)}
                            disabled={pending}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors active:scale-95 disabled:opacity-40"
                          >
                            {reply.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {pending && (
                  <div className="flex justify-start gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black"
                      style={{ background: 'rgba(245,166,35,0.18)' }}
                    >
                      <MessageCircle size={12} strokeWidth={2.1} />
                    </span>
                    <div className="rounded-2xl rounded-bl-md border border-white/8 bg-white/5 px-4 py-3">
                      <span className="inline-flex gap-1" aria-label="Lumi is thinking">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/45" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/45" style={{ animationDelay: '120ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/45" style={{ animationDelay: '240ms' }} />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 px-3 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
              {error && (
                <div className="mb-3 rounded-2xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                  {error}
                </div>
              )}
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendMessage(draft)
                }}
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask Lumi anything"
                  aria-label="Message Lumi"
                  className="lx-field min-w-0 flex-1 rounded-full px-4 py-3 text-sm outline-none"
                />
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-black transition-transform active:scale-95 disabled:opacity-40"
                  style={{ background: 'var(--color-amber)' }}
                  aria-label="Send message"
                >
                  <Send size={16} strokeWidth={2.4} />
                </button>
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
