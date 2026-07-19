'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'

type Summary = {
  id: string
  referral_code: string
  referral_link: string
  commission_rate: number
  target_monthly_orders: number
  status: string
  earnings_kobo: number
  paid_kobo: number
  pending_kobo: number
}

export function CampusPartnersClient({ summary }: { summary: Summary | null }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [campusId, setCampusId] = useState('')
  const [territory, setTerritory] = useState('')
  const [applicationText, setApplicationText] = useState('')
  const [target, setTarget] = useState('0')
  const [commission, setCommission] = useState('0.05')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submit() {
    setError('')
    setSuccess('')
    const res = await fetch('/api/campus-partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        phone,
        campus_id: campusId || null,
        territory: territory || null,
        application_text: applicationText || null,
        target_monthly_orders: Number(target) || 0,
        proposed_commission_rate: Number(commission) || 0,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Could not submit application')
      return
    }
    setSuccess('Application sent')
  }

  return (
    <div className="space-y-4">
      {summary ? (
        <section className="lx-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Your partner account</p>
              <h2 className="text-xl font-semibold text-white">{summary.referral_code}</h2>
              <p className="text-sm text-white/55 break-all">{summary.referral_link}</p>
            </div>
            <Badge color="var(--lx-green)">{summary.status}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3"><p className="text-xs uppercase tracking-wide text-white/40">Earnings</p><p className="mt-1 text-lg font-semibold text-white">{Math.round(summary.earnings_kobo / 100).toLocaleString('en-NG')}</p></div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3"><p className="text-xs uppercase tracking-wide text-white/40">Paid</p><p className="mt-1 text-lg font-semibold text-white">{Math.round(summary.paid_kobo / 100).toLocaleString('en-NG')}</p></div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3"><p className="text-xs uppercase tracking-wide text-white/40">Pending</p><p className="mt-1 text-lg font-semibold text-white">{Math.round(summary.pending_kobo / 100).toLocaleString('en-NG')}</p></div>
          </div>
        </section>
      ) : (
        <section className="lx-surface p-4 space-y-3">
          <p className="text-sm text-white/60">Apply as a campus partner and earn performance-based commissions from completed referrals.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" className="lx-field px-4 py-3" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="lx-field px-4 py-3" />
            <input value={campusId} onChange={(e) => setCampusId(e.target.value)} placeholder="Campus ID" className="lx-field px-4 py-3" />
            <input value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="Territory" className="lx-field px-4 py-3" />
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Monthly target orders" className="lx-field px-4 py-3" />
            <input value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="Commission rate" className="lx-field px-4 py-3" />
          </div>
          <textarea value={applicationText} onChange={(e) => setApplicationText(e.target.value)} placeholder="Tell us why you’re a good fit" className="lx-field w-full px-4 py-3" rows={4} />
          {error && <p className="text-sm text-red-300">{error}</p>}
          {success && <p className="text-sm text-emerald-300">{success}</p>}
          <button type="button" onClick={() => void submit()} className="lx-btn-amber px-4 py-3 text-sm">Submit application</button>
        </section>
      )}
    </div>
  )
}
