'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, MessageCircle, Send, X } from 'lucide-react'
import type { OrderConversationChannel, OrderParticipantType } from '@/lib/order-communication'

interface ChatMessage {
  id: string
  sender_id: string | null
  sender_type: OrderParticipantType | 'SYSTEM'
  message_type: 'USER' | 'SYSTEM'
  body: string
  metadata: Record<string, unknown>
  created_at: string
  sending?: boolean
  failed?: boolean
}

interface ReadReceipt {
  participant_type: OrderParticipantType
  participant_id: string
  last_read_at: string
  last_read_message_id?: string | null
}

interface ChatPayload {
  messages: ChatMessage[]
  reads: ReadReceipt[]
  writable: boolean
  closes_at: string | null
  has_more: boolean
  next_cursor: string | null
}

export function orderChatQuickReplies(
  actorType: OrderParticipantType,
  channel: OrderConversationChannel,
): string[] {
  if (actorType === 'CUSTOMER' && channel === 'CUSTOMER_RIDER') {
    return ['Where are you now?', 'Please call when you arrive', 'I am at the gate']
  }
  if (actorType === 'VENDOR' && channel === 'VENDOR_RIDER') {
    return ['Order is ready', 'Please come for pickup', 'There is a short delay']
  }
  if (actorType === 'RIDER' && channel === 'CUSTOMER_RIDER') {
    return ['I am on my way', 'I have arrived', 'Please come out']
  }
  if (actorType === 'RIDER' && channel === 'VENDOR_RIDER') {
    return ['I am coming for pickup', 'Is the order ready?', 'I am at the vendor']
  }
  return []
}

export interface OrderChatSheetProps {
  open: boolean
  orderId: string
  orderNumber: string
  channel: OrderConversationChannel
  actor: { id: string; type: OrderParticipantType }
  title: string
  participantLabels?: Partial<Record<OrderParticipantType, string>>
  onClose: () => void
  onUnreadChange?: (count: number) => void
}

export function OrderChatButton({
  label, unread = 0, onClick, className = '',
}: {
  label: string
  unread?: number
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`lx-tap relative inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 text-sm font-semibold text-amber-300 ${className}`}
      aria-label={unread > 0 ? `${label}, ${unread} unread` : label}
    >
      <MessageCircle size={17} aria-hidden="true" />
      {label}
      {unread > 0 && (
        <span className="min-w-5 rounded-full bg-amber-400 px-1.5 py-0.5 text-center text-[10px] font-bold text-black" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

function mergeMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = current.findIndex((message) => message.id === incoming.id)
  if (index === -1) return [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const next = [...current]
  next[index] = { ...next[index], ...incoming }
  return next
}

export function OrderChatSheet({
  open,
  orderId,
  orderNumber,
  channel,
  actor,
  title,
  participantLabels,
  onClose,
  onUnreadChange,
}: OrderChatSheetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reads, setReads] = useState<ReadReceipt[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [writable, setWritable] = useState(true)
  const [closesAt, setClosesAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const prependScroll = useRef<{ height: number; top: number } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const labels = useMemo(() => ({
    CUSTOMER: 'Customer', VENDOR: 'Vendor', RIDER: 'Rider', ...participantLabels,
  }), [participantLabels])
  const quickReplies = useMemo(() => orderChatQuickReplies(actor.type, channel), [actor.type, channel])

  const endpoint = `/api/orders/${encodeURIComponent(orderId)}/messages`
  const load = useCallback(async (before?: string) => {
    if (before) {
      setLoadingOlder(true)
      if (listRef.current) prependScroll.current = {
        height: listRef.current.scrollHeight,
        top: listRef.current.scrollTop,
      }
    }
    else setLoading(true)
    setError('')
    try {
      const cursor = before ? `&before=${encodeURIComponent(before)}` : ''
      const response = await fetch(`${endpoint}?channel=${channel}${cursor}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as Partial<ChatPayload> & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not load this conversation')
      setMessages((current) => (data.messages ?? []).reduce(mergeMessage, current))
      setReads(data.reads ?? [])
      setWritable(data.writable ?? false)
      setClosesAt(data.closes_at ?? null)
      setHasMore(data.has_more ?? false)
      setNextCursor(data.next_cursor ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this conversation')
    } finally {
      if (before) setLoadingOlder(false)
      else setLoading(false)
    }
  }, [channel, endpoint])

  useEffect(() => {
    if (!open) return
    setMessages([])
    setReads([])
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void load()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => inputRef.current?.focus(), 50)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus.current?.focus()
    }
  }, [channel, load, open, orderId])

  useEffect(() => {
    if (!open) return
    const source = new EventSource(`${endpoint}/stream?channel=${channel}`)
    const onMessage = (event: MessageEvent<string>) => {
      const incoming = JSON.parse(event.data) as ChatMessage
      setMessages((current) => mergeMessage(current, incoming))
    }
    const onReceipt = (event: MessageEvent<string>) => {
      const receipt = JSON.parse(event.data) as ReadReceipt
      setReads((current) => [
        ...current.filter((item) => !(
          item.participant_type === receipt.participant_type
          && item.participant_id === receipt.participant_id
        )),
        receipt,
      ])
    }
    const onState = (event: MessageEvent<string>) => {
      const state = JSON.parse(event.data) as { writable: boolean; closes_at: string | null }
      setWritable(state.writable)
      setClosesAt(state.closes_at)
    }
    const onRevoked = () => {
      setWritable(false)
      setError('Your access to this order conversation has ended.')
      source.close()
    }
    source.addEventListener('message', onMessage as EventListener)
    source.addEventListener('receipt', onReceipt as EventListener)
    source.addEventListener('state', onState as EventListener)
    source.addEventListener('access_revoked', onRevoked)
    return () => source.close()
  }, [channel, endpoint, open])

  useEffect(() => {
    if (!open || messages.length === 0) return
    const latest = [...messages].reverse().find((message) => !message.id.startsWith('optimistic:'))
    if (!latest) return
    const timer = window.setTimeout(() => {
      void fetch(`${endpoint}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, message_id: latest.id }),
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [channel, endpoint, messages, open])

  useEffect(() => {
    if (prependScroll.current && listRef.current) {
      const previous = prependScroll.current
      listRef.current.scrollTop = previous.top + (listRef.current.scrollHeight - previous.height)
      prependScroll.current = null
    } else {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
    }
    if (open) onUnreadChange?.(0)
  }, [messages, onUnreadChange, open])

  const send = async () => {
    const body = draft.trim()
    if (!body || !writable || body.length > 300) return
    const clientId = crypto.randomUUID()
    const optimisticId = `optimistic:${clientId}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      sender_id: actor.id,
      sender_type: actor.type,
      message_type: 'USER',
      body,
      metadata: {},
      created_at: new Date().toISOString(),
      sending: true,
    }
    setMessages((current) => mergeMessage(current, optimistic))
    setDraft('')
    setError('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, message: body, client_message_id: clientId }),
      })
      const data = await response.json().catch(() => ({})) as { message?: ChatMessage; error?: string }
      if (!response.ok || !data.message) throw new Error(data.error ?? 'Message could not be sent')
      setMessages((current) => mergeMessage(
        current.filter((message) => message.id !== optimisticId),
        data.message!,
      ))
    } catch (cause) {
      setMessages((current) => current.map((message) => (
        message.id === optimisticId ? { ...message, sending: false, failed: true } : message
      )))
      setError(cause instanceof Error ? cause.message : 'Message could not be sent')
    }
  }

  if (!open) return null
  const otherRead = reads
    .filter((receipt) => receipt.participant_id !== actor.id)
    .sort((a, b) => b.last_read_at.localeCompare(a.last_read_at))[0]

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/65 backdrop-blur-[2px] sm:items-center sm:px-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-chat-title"
        className="flex h-[min(92dvh,44rem)] w-full max-w-[100vw] flex-col overflow-hidden rounded-t-3xl border border-white/10 sm:h-[min(85dvh,44rem)] sm:max-w-lg sm:rounded-3xl"
        style={{ background: 'var(--lx-surface-solid)', boxShadow: '0 -12px 50px rgba(0,0,0,.55)' }}
      >
        <header className="flex min-h-[64px] items-center gap-3 border-b border-white/8 px-4">
          <div className="min-w-0 flex-1">
            <h2 id="order-chat-title" className="truncate text-base font-bold text-white">{title}</h2>
            <p className="text-xs text-white/40">Order {orderNumber}</p>
          </div>
          <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-white/60 hover:bg-white/5" aria-label="Close conversation">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div ref={listRef} role="log" aria-relevant="additions text" className="flex-1 overscroll-contain space-y-3 overflow-y-auto px-3 py-4 touch-pan-y sm:px-4" aria-live="polite" aria-busy={loading}>
          {loading && <p className="py-10 text-center text-sm text-white/40">Loading messages…</p>}
          {!loading && hasMore && nextCursor && (
            <button
              type="button"
              onClick={() => void load(nextCursor)}
              disabled={loadingOlder}
              className="mx-auto block min-h-11 rounded-xl px-4 text-xs font-medium text-amber-300 disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {!loading && messages.length === 0 && !error && (
            <div className="mx-auto max-w-xs py-10 text-center">
              <MessageCircle className="mx-auto text-amber-300/70" size={28} aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-white">No messages yet</p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">Keep this conversation about this order.</p>
            </div>
          )}
          {messages.map((message) => {
            if (message.message_type === 'SYSTEM') {
              return <p key={message.id} className="mx-auto max-w-[90%] text-center text-xs text-white/40">{message.body}</p>
            }
            const mine = message.sender_id === actor.id
            const wasRead = mine && otherRead && otherRead.last_read_at >= message.created_at
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[82%]">
                  {!mine && <p className="mb-1 px-1 text-[11px] font-medium text-white/40">{labels[message.sender_type as OrderParticipantType]}</p>}
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${mine ? 'rounded-br-md bg-amber-400 text-black' : 'rounded-bl-md bg-white/[0.07] text-white'}`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <span className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-black/55' : 'text-white/35'}`}>
                      {new Date(message.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                      {mine && (wasRead ? <CheckCheck size={13} aria-label="Read" /> : <Check size={13} aria-label={message.failed ? 'Failed' : message.sending ? 'Sending' : 'Sent'} />)}
                    </span>
                  </div>
                  {message.failed && <p className="mt-1 text-right text-[11px] text-red-300">Not sent</p>}
                </div>
              </div>
            )
          })}
        </div>

        <footer className="shrink-0 border-t border-white/8 px-3 pt-3" style={{ paddingBottom: 'calc(.75rem + env(safe-area-inset-bottom))' }}>
          {error && <p role="alert" className="mb-2 px-1 text-xs text-red-300">{error}</p>}
          {!writable ? (
            <div role="status" className="rounded-xl bg-white/[0.05] px-4 py-3 text-center text-xs text-white/55">
              This conversation is read-only{closesAt ? ` since ${new Date(closesAt).toLocaleString('en-NG')}` : ''}.
            </div>
          ) : (
            <div>
              <div role="group" className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Quick replies">
                {quickReplies.map((reply) => (
                  <button
                    type="button"
                    key={reply}
                    onClick={() => { setDraft(reply); inputRef.current?.focus() }}
                    className="min-h-11 shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3 text-xs text-white/65 hover:border-amber-400/30 hover:text-amber-200"
                  >
                    {reply}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <label className="sr-only" htmlFor={`order-chat-${channel}`}>Message</label>
                <textarea
                  ref={inputRef}
                  id={`order-chat-${channel}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 300))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
                  }}
                  rows={1}
                  maxLength={300}
                  aria-describedby={`order-chat-count-${channel}`}
                  placeholder="Message about this order"
                  className="lx-field min-h-11 min-w-0 max-h-28 flex-1 resize-none px-3 py-2.5 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!draft.trim()}
                  className="lx-btn-amber grid min-h-11 min-w-11 place-items-center rounded-xl disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          {writable && <p id={`order-chat-count-${channel}`} className="mt-1.5 px-1 text-right text-[10px] text-white/30">{draft.length}/300</p>}
        </footer>
      </div>
    </div>
  )
}
