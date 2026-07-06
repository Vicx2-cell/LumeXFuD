"use client"
import React, { useState } from 'react'

type Message = { from: 'user' | 'lumi'; text: string }

export default function LumiChat({ userId }: { userId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [quickReplies, setQuickReplies] = useState<string[] | undefined>(undefined)

  async function send(msg: string) {
    setMessages((m) => [...m, { from: 'user', text: msg }])
    setLoading(true)
    try {
      const res = await fetch('/api/lumi', { method: 'POST', body: JSON.stringify({ userId, message: msg }), headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      setMessages((m) => [...m, { from: 'lumi', text: data.text }])
      setQuickReplies(data.quickReplies)
    } catch (e) {
      setMessages((m) => [...m, { from: 'lumi', text: 'Error contacting Lumi.' }])
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickReply(q: string) {
    // Special-case confirm flow
    if (q.toLowerCase().includes('yes') && q.toLowerCase().includes('place')) {
      // Ask server for the draft, then POST to /api/orders as the authenticated user
      setLoading(true)
      try {
        const r = await fetch('/api/lumi/confirm', { method: 'POST', body: JSON.stringify({ userId }), headers: { 'Content-Type': 'application/json' } })
        const j = await r.json()
        if (j.draft) {
          const ord = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j.draft) })
          const res = await ord.json()
          if (ord.ok) {
            setMessages((m) => [...m, { from: 'lumi', text: `Order placed — ${res.order_number || 'check Orders'}` }])
          } else {
            setMessages((m) => [...m, { from: 'lumi', text: res.error || 'Could not place order.' }])
          }
        } else {
          setMessages((m) => [...m, { from: 'lumi', text: j.error || 'No draft found.' }])
        }
      } catch (e) {
        setMessages((m) => [...m, { from: 'lumi', text: 'Network error placing order.' }])
      } finally {
        setLoading(false)
        setQuickReplies(undefined)
      }
      return
    }

    // default: send as plain message
    setText(q)
    send(q)
    setQuickReplies(undefined)
  }

  return (
    <div className="bg-[rgba(255,255,255,0.03)] p-3 rounded-lg glass">
      <div className="h-64 overflow-auto mb-2">
        {messages.map((m, i) => (
          <div key={i} className={`mb-2 ${m.from === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-3 py-2 rounded ${m.from === 'user' ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'}`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
      {quickReplies && (
        <div className="mb-2 flex gap-2">
          {quickReplies.map((q) => (
            <button key={q} className="bg-white/10 text-white px-3 py-1 rounded" onClick={() => handleQuickReply(q)}>{q}</button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} className="flex-1 rounded p-2 bg-white/5 text-white" />
        <button disabled={loading || !text.trim()} onClick={() => { if (text.trim()) { send(text.trim()); setText('') } }} className="bg-amber-400 px-4 rounded">{loading ? '...' : 'Send'}</button>
      </div>
    </div>
  )
}
