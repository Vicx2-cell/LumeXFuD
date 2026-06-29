'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

interface LastMsg { direction: 'in' | 'out'; body: string | null; created_at: string }
interface Conversation {
  phone: string
  role: string | null
  state: string
  mode: string
  updated_at: string
  last?: LastMsg | null
}
interface ThreadMsg { id: string; direction: 'in' | 'out'; msg_type: string | null; body: string | null; created_at: string }

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '')

export default function SuperAdminWhatsAppInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadMsg[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const loadList = useCallback(async () => {
    const res = await fetch('/api/admin/whatsapp')
    if (res.ok) {
      const d = (await res.json()) as { conversations: Conversation[] }
      setConversations(d.conversations)
    }
    setLoading(false)
  }, [])

  const loadThread = useCallback(async (phone: string) => {
    const res = await fetch(`/api/admin/whatsapp?phone=${encodeURIComponent(phone)}`)
    if (res.ok) {
      const d = (await res.json()) as { messages: ThreadMsg[] }
      setThread(d.messages)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [])

  // Poll the list (and the open thread) so new inbound messages appear live.
  useEffect(() => {
    loadList()
    const t = setInterval(() => {
      loadList()
      if (active) loadThread(active)
    }, 7000)
    return () => clearInterval(t)
  }, [loadList, loadThread, active])

  function openConversation(phone: string) {
    setActive(phone)
    setThread([])
    loadThread(phone)
  }

  async function sendReply() {
    if (!active || !reply.trim()) return
    setBusy(true)
    const res = await fetch('/api/admin/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reply', phone: active, text: reply.trim() }),
    })
    if (res.ok) {
      setReply('')
      await loadThread(active)
      showToast('Sent')
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showToast(d.error ?? 'Send failed')
    }
    setBusy(false)
  }

  async function handBack() {
    if (!active) return
    setBusy(true)
    const res = await fetch('/api/admin/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'handback', phone: active }),
    })
    if (res.ok) {
      showToast('Handed back to bot')
      setActive(null)
      setThread([])
      loadList()
    } else {
      showToast('Failed')
    }
    setBusy(false)
  }

  return (
    <div className="lx-console min-h-screen px-4 py-6 max-w-5xl mx-auto">
      <GlassSheen />
      <PageHeader
        title="WhatsApp Inbox"
        subtitle="Conversations the bot handed to a human"
        badge="Super Admin"
        actions={
          <button onClick={loadList} className="lx-btn-ghost text-sm px-3 py-1.5">Refresh</button>
        }
      />

      <div className="grid md:grid-cols-[300px_1fr] gap-4 mt-4">
        {/* Conversation list */}
        <aside className="lx-surface rounded-2xl p-2 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="lx-mono text-xs opacity-60 p-4">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="lx-mono text-xs opacity-60 p-4">No conversations need a human right now. 🎉</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.phone}
                onClick={() => openConversation(c.phone)}
                className={`w-full text-left rounded-xl p-3 mb-1 transition ${active === c.phone ? 'bg-white/10' : 'hover:bg-white/5'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.phone}</span>
                  <span className="lx-mono text-[10px] uppercase opacity-60">{c.role ?? 'unknown'}</span>
                </div>
                <p className="text-xs opacity-70 truncate mt-0.5">
                  {c.last ? `${c.last.direction === 'in' ? '↘︎ ' : '↗︎ '}${c.last.body ?? ''}` : '—'}
                </p>
                <p className="lx-mono text-[10px] opacity-40 mt-0.5">{fmtTime(c.updated_at)}</p>
              </button>
            ))
          )}
        </aside>

        {/* Thread + reply */}
        <section className="lx-surface rounded-2xl flex flex-col max-h-[70vh]">
          {!active ? (
            <div className="flex-1 grid place-items-center p-8">
              <p className="lx-mono text-xs opacity-50">Select a conversation to view the thread.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between p-3 border-b border-white/10">
                <span className="font-medium text-sm">{active}</span>
                <button onClick={handBack} disabled={busy} className="lx-btn-ghost text-xs px-3 py-1.5">
                  ↩︎ Hand back to bot
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {thread.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'out' ? 'bg-amber-500/20' : 'bg-white/8'}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body || <span className="opacity-50 italic">({m.msg_type})</span>}</p>
                      <p className="lx-mono text-[10px] opacity-40 mt-1">{fmtTime(m.created_at)}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="p-3 border-t border-white/10 flex gap-2">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  placeholder="Type a reply…"
                  className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-sm outline-none focus:bg-white/10"
                />
                <button onClick={sendReply} disabled={busy || !reply.trim()} className="lx-btn px-4 py-2 text-sm disabled:opacity-50">
                  Send
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black/80 text-white text-sm px-4 py-2 rounded-xl border border-white/10">
          {toast}
        </div>
      )}
    </div>
  )
}
