'use client'

import { useEffect, useRef, useState } from 'react'
import { isReportShake } from '@/lib/shake-report'

export function ShakeIssueReporter() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const lastShake = useRef(0)

  useEffect(() => {
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity
      if (!a) return
      const now = Date.now()
      if (!isReportShake({ x: a.x, y: a.y, z: a.z, now, lastTriggeredAt: lastShake.current })) return
      lastShake.current = now
      setOpen(true)
    }
    window.addEventListener('devicemotion', onMotion)
    return () => window.removeEventListener('devicemotion', onMotion)
  }, [])

  async function submit() {
    if (!email.trim() || message.trim().length < 20) {
      setNotice('Add your email and at least 20 characters so we can help.')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'support', name: 'LumeX app user', email, subject: 'In-app issue report', message }),
      })
      const result = await response.json() as { error?: string; reference?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not send report')
      setNotice(`Report sent${result.reference ? ` (${result.reference})` : ''}. Thank you.`)
      setMessage('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send report')
    } finally {
      setBusy(false)
    }
  }

  return <>
    {open ? <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Report an issue">
      <div className="w-full max-w-md rounded-2xl bg-[#151515] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-white">Report an issue</h2><p className="mt-1 text-sm text-white/60">Tell us what happened. Do not include passwords, PINs, or delivery codes.</p></div><button onClick={() => setOpen(false)} className="text-white/60" aria-label="Close">×</button></div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Your email" className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-white outline-none" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} placeholder="What were you trying to do? What went wrong?" rows={5} className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-white outline-none" />
        {notice ? <p className="mt-2 text-sm text-white/70">{notice}</p> : null}
        <button onClick={submit} disabled={busy} className="mt-4 w-full rounded-xl bg-[#F5A623] py-3 font-semibold text-black disabled:opacity-50">{busy ? 'Sending…' : 'Send report'}</button>
      </div>
    </div> : null}
  </>
}
