'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'

interface Conversation {
  id: string
  channel: 'CUSTOMER_RIDER' | 'VENDOR_RIDER'
  assignment_version: number
  is_active: boolean
  riders: { full_name: string } | null
}

interface TranscriptMessage {
  id: string
  conversation_id: string
  sender_type: 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'SYSTEM'
  message_type: 'USER' | 'SYSTEM'
  body: string
  created_at: string
}

export function OrderDisputeTranscript({
  orderId, orderNumber, onClose,
}: {
  orderId: string
  orderNumber: string
  onClose: () => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/admin/disputes/${encodeURIComponent(orderId)}/messages`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as {
        conversations?: Conversation[]; messages?: TranscriptMessage[]; error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Could not load transcript')
      setConversations(payload.conversations ?? [])
      setMessages(payload.messages ?? [])
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load transcript')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [orderId])

  useEffect(() => {
    const previous = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/65 sm:items-center sm:px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="transcript-title" className="flex h-[min(92dvh,46rem)] w-full max-w-[100vw] flex-col overflow-hidden rounded-t-3xl border border-white/10 sm:h-[min(85dvh,46rem)] sm:max-w-2xl sm:rounded-3xl" style={{ background: 'var(--lx-surface-solid)' }}>
        <header className="flex min-h-16 items-center border-b border-white/8 px-4">
          <div className="min-w-0 flex-1">
            <h2 id="transcript-title" className="font-bold text-white">Order chat transcript</h2>
            <p className="text-xs text-white/40">{orderNumber} · Read-only dispute evidence</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-white/60" aria-label="Close transcript"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="flex-1 overscroll-contain space-y-5 overflow-y-auto p-3 touch-pan-y sm:p-4">
          {loading && <p className="py-10 text-center text-sm text-white/45">Loading transcript…</p>}
          {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          {!loading && !error && conversations.length === 0 && (
            <div className="py-10 text-center text-white/45"><MessageCircle className="mx-auto mb-2" /><p className="text-sm">No order messages were sent.</p></div>
          )}
          {conversations.map((conversation) => (
            <section key={conversation.id} className="rounded-2xl border border-white/8 bg-white/[0.025] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                  {conversation.channel === 'CUSTOMER_RIDER' ? 'Customer ↔ Rider' : 'Vendor ↔ Rider'} · Assignment {conversation.assignment_version}
                </h3>
                <span className="text-[10px] text-white/35">{conversation.riders?.full_name ?? 'Former rider'}{conversation.is_active ? ' · current' : ''}</span>
              </div>
              <div className="space-y-2">
                {messages.filter((message) => message.conversation_id === conversation.id).map((message) => (
                  <div key={message.id} className={message.message_type === 'SYSTEM' ? 'text-center text-xs text-white/35' : 'rounded-xl bg-white/[0.05] px-3 py-2'}>
                    {message.message_type === 'USER' && <p className="text-[10px] font-semibold text-white/40">{message.sender_type}</p>}
                    <p className="whitespace-pre-wrap break-words text-sm text-white/80">{message.body}</p>
                    <p className="mt-1 text-[10px] text-white/30">{new Date(message.created_at).toLocaleString('en-NG')}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
