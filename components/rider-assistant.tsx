'use client'

import { useState, useRef, useEffect } from 'react'

interface Msg { role: 'user' | 'assistant'; content: string }

const AMBER_GRADIENT = 'linear-gradient(135deg, #FFB84D 0%, #F5A623 45%, #E8841A 100%)'

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi 👋 I'm your earnings assistant. Ask me about your balance, when you get paid, or any money that's on hold.",
}
const QUICK = ['How much have I earned?', 'When do I get paid?', "Why is my money on hold?"]

export function RiderAssistant() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

  async function send(text: string) {
    const clean = text.trim()
    if (!clean || loading) return
    const next: Msg[] = [...msgs, { role: 'user', content: clean }]
    setMsgs(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/rider-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      })
      const d = await res.json() as { reply?: string; error?: string }
      setMsgs((m) => [...m, { role: 'assistant', content: res.ok ? (d.reply ?? '') : (d.error ?? 'Something went wrong. Try again.') }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error — please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 z-40 flex items-center gap-2.5 pl-2 pr-4 rounded-full active:scale-95 transition-transform"
          style={{
            bottom: 'calc(1.5rem + env(safe-area-inset-bottom))', minHeight: 48,
            background: 'rgba(20,20,22,0.72)', border: '1px solid rgba(245,166,35,0.35)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 10px 34px rgba(245,166,35,0.25)',
          }}
          aria-label="Open earnings assistant"
        >
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-base" style={{ background: AMBER_GRADIENT }}>💸</span>
          <span className="text-sm font-semibold text-white">Earnings help</span>
        </button>
      )}

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }} onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg flex flex-col"
            style={{ background: 'linear-gradient(180deg, #16161A 0%, #0E0E10 100%)', border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none', borderTopLeftRadius: 26, borderTopRightRadius: 26, height: '82dvh', maxHeight: '82dvh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2.5 pb-1"><span className="w-9 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} /></div>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg" style={{ background: AMBER_GRADIENT }}>💸</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px] leading-tight">Earnings assistant</p>
                <p className="text-[11px] text-white/45 leading-tight mt-0.5">Payouts, holds & balance · online</p>
              </div>
              <button onClick={() => setOpen(false)} className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center active:scale-90" style={{ background: 'rgba(255,255,255,0.06)' }} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[82%] px-3.5 py-2.5 text-sm leading-relaxed"
                    style={m.role === 'user'
                      ? { background: AMBER_GRADIENT, color: '#1a1205', borderRadius: 18, borderBottomRightRadius: 5, fontWeight: 500 }
                      : { background: 'rgba(255,255,255,0.055)', color: 'rgba(255,255,255,0.92)', borderRadius: 18, borderBottomLeftRadius: 5, border: '1px solid rgba(255,255,255,0.06)' }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.055)' }}>
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/45 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/45 animate-bounce" style={{ animationDelay: '120ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/45 animate-bounce" style={{ animationDelay: '240ms' }} />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick chips */}
            {msgs.length === 1 && (
              <div className="px-4 pb-1.5 flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <button key={q} onClick={() => send(q)} className="text-xs px-3.5 py-2 rounded-full active:scale-95 transition-transform"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.72)', border: '1px solid rgba(255,255,255,0.07)' }}>{q}</button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: 'rgba(255,255,255,0.07)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
                placeholder="Ask about your earnings…"
                enterKeyHint="send"
                className="flex-1 min-w-0 rounded-full px-4 py-2.5 text-base outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              />
              <button onClick={() => send(input)} disabled={loading || !input.trim()}
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform"
                style={{ background: AMBER_GRADIENT, color: '#1a1205' }} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
