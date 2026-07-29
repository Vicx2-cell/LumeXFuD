'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { quotePromotion, type Promotion } from '@/lib/promotion'
import { formatPrice } from '@/lib/money'

type Row = Record<string, unknown> & { id: string; code: string; status: 'ACTIVE' | 'PAUSED'; discount_type: string; spent_kobo: number }

const input = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm'

export default function PromotionsPage() {
  const now = new Date()
  const [rows, setRows] = useState<Row[]>([])
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    code: '',
    promotion_kind: 'STANDARD',
    discount_type: 'FIXED',
    value_naira: 500,
    percentage: 10,
    cap_naira: 1000,
    minimum_naira: 0,
    vendor_id: '',
    category: '',
    campus_id: '',
    first_order_only: false,
    group_order_only: false,
    starts_at: now.toISOString().slice(0, 16),
    expires_at: '',
    total_uses: '',
    uses_per_customer: '1',
    funding_source: 'LUMEX',
    campaign_budget_naira: 10000,
    status: 'PAUSED',
  })

  const load = () => fetch('/api/admin/promotions', { cache: 'no-store' }).then((r) => r.json()).then((d) => setRows(d.promotions ?? []))
  useEffect(() => { void load() }, [])

  const applyPreset = (preset: Partial<typeof form>) => setForm((current) => ({ ...current, ...preset }))

  const preview = useMemo(() => quotePromotion({
    discountType: form.discount_type as Promotion['discountType'],
    valueKobo: Math.round(form.value_naira * 100),
    percentageBps: Math.round(form.percentage * 100),
    percentageCapKobo: Math.round(form.cap_naira * 100),
    minimumSubtotalKobo: Math.round(form.minimum_naira * 100),
    startsAt: new Date(form.starts_at).toISOString(),
    expiresAt: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    status: 'ACTIVE',
    firstOrderOnly: form.first_order_only,
    groupOrderOnly: form.group_order_only,
  }, {
    subtotalKobo: 500000,
    deliveryFeeKobo: 50000,
    platformFeeKobo: 40000,
    isFirstOrder: true,
    isGroupOrder: form.group_order_only,
    now: new Date(form.starts_at),
  }), [form])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMessage('')
    const response = await fetch('/api/admin/promotions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: form.code,
        promotion_kind: form.promotion_kind,
        discount_type: form.discount_type,
        value_kobo: Math.round(form.value_naira * 100),
        percentage_bps: Math.round(form.percentage * 100),
        percentage_cap_kobo: form.discount_type === 'PERCENTAGE' ? Math.round(form.cap_naira * 100) : null,
        minimum_subtotal_kobo: Math.round(form.minimum_naira * 100),
        eligible_vendor_id: form.vendor_id || null,
        eligible_category: form.category || null,
        eligible_campus_id: form.campus_id || null,
        first_order_only: form.first_order_only,
        group_order_only: form.group_order_only,
        starts_at: new Date(form.starts_at).toISOString(),
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        total_uses_limit: form.total_uses ? Number(form.total_uses) : null,
        uses_per_customer: form.uses_per_customer ? Number(form.uses_per_customer) : null,
        funding_source: form.funding_source,
        campaign_budget_kobo: form.campaign_budget_naira ? Math.round(form.campaign_budget_naira * 100) : null,
        status: form.status,
      }),
    })
    const data = await response.json()
    setMessage(response.ok ? `Promotion ${data.promotion.code} created.` : data.error ?? 'Could not create promotion')
    if (response.ok) {
      setForm((v) => ({ ...v, code: '', status: 'PAUSED' }))
      void load()
    }
  }

  return (
    <main className="min-h-screen bg-[#090909] p-4 text-white sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[.18em] text-amber-400">Admin</p>
            <h1 className="text-3xl font-semibold">Promotions</h1>
          </div>
          <Link className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-black" href="/admin/promotions/fund">Promo Fund</Link>
        </div>

        <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-white/10 bg-white/[.03] p-5 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75" onClick={() => applyPreset({ discount_type: 'FIXED', value_naira: 500, percentage: 10, cap_naira: 1000, minimum_naira: 0, status: 'PAUSED' })}>₦500 off</button>
              <button type="button" className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75" onClick={() => applyPreset({ discount_type: 'PERCENTAGE', percentage: 10, cap_naira: 1500, value_naira: 500, status: 'PAUSED' })}>10% off</button>
              <button type="button" className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75" onClick={() => applyPreset({ discount_type: 'FREE_DELIVERY', value_naira: 750, minimum_naira: 0, status: 'PAUSED' })}>Free delivery</button>
              <button type="button" className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75" onClick={() => applyPreset({ first_order_only: true, total_uses: '100', uses_per_customer: '1', status: 'PAUSED' })}>First order</button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label>Code<input required className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
              <label>Promotion type<select className={input} value={form.promotion_kind} onChange={(e) => setForm({ ...form, promotion_kind: e.target.value })}>{['STANDARD', 'VENDOR', 'GROUP_ORDER', 'REFERRAL', 'AMBASSADOR'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>Discount type<select className={input} value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>{['FIXED', 'PERCENTAGE', 'DELIVERY', 'FREE_DELIVERY', 'PLATFORM_FEE'].map((x) => <option key={x}>{x}</option>)}</select></label>
              {form.discount_type === 'PERCENTAGE'
                ? <>
                    <label>Percentage<input className={input} type="number" min="0.01" max="100" step=".01" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: Number(e.target.value) })} /></label>
                    <label>Percentage cap (₦)<input className={input} type="number" value={form.cap_naira} onChange={(e) => setForm({ ...form, cap_naira: Number(e.target.value) })} /></label>
                  </>
                : <label>Value / cap (₦)<input className={input} type="number" min="0" value={form.value_naira} onChange={(e) => setForm({ ...form, value_naira: Number(e.target.value) })} /></label>}
              <label>Minimum subtotal (₦)<input className={input} type="number" min="0" value={form.minimum_naira} onChange={(e) => setForm({ ...form, minimum_naira: Number(e.target.value) })} /></label>
              <label>Funding<select className={input} value={form.funding_source} onChange={(e) => setForm({ ...form, funding_source: e.target.value })}><option>LUMEX</option><option>VENDOR</option></select></label>
              <label>Campaign budget (₦)<input className={input} type="number" min="1" value={form.campaign_budget_naira} onChange={(e) => setForm({ ...form, campaign_budget_naira: Number(e.target.value) })} /></label>
              <label>Activation<select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="PAUSED">Save paused</option><option value="ACTIVE">Activate now</option></select></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.first_order_only} onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })} /> First order only</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.group_order_only} onChange={(e) => setForm({ ...form, group_order_only: e.target.checked })} /> Group order only</label>
            </div>

            <details className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
              <summary className="cursor-pointer text-sm font-semibold text-white/80">Advanced targeting and limits</summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label>Vendor ID (optional)<input className={input} value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} /></label>
                <label>Category (optional)<input className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
                <label>Campus ID (optional)<input className={input} value={form.campus_id} onChange={(e) => setForm({ ...form, campus_id: e.target.value })} /></label>
                <label>Starts<input className={input} type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
                <label>Expires (optional)<input className={input} type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></label>
                <label>Total uses<input className={input} type="number" min="1" value={form.total_uses} onChange={(e) => setForm({ ...form, total_uses: e.target.value })} /></label>
                <label>Uses/customer<input className={input} type="number" min="1" value={form.uses_per_customer} onChange={(e) => setForm({ ...form, uses_per_customer: e.target.value })} /></label>
              </div>
            </details>
          </div>

          <aside className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-400">Live preview</p>
            <p className="mt-3 text-2xl font-semibold">{form.code || 'YOURCODE'}</p>
            <p className="mt-2 text-white/70">On a ₦5,000 basket, ₦500 delivery and ₦400 platform fee:</p>
            <p className="mt-4 text-3xl font-semibold text-amber-300">{formatPrice(preview)} off</p>
            <button className="mt-6 w-full rounded-xl bg-white px-4 py-3 font-semibold text-black">Create promotion</button>
            {message && <p className="mt-3 text-sm">{message}</p>}
          </aside>
        </form>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="text-white/50">
              <tr>
                <th className="p-3">Code</th>
                <th>Type</th>
                <th>Status</th>
                <th>Spent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/10">
                  <td className="p-3 font-semibold">{row.code}</td>
                  <td>{row.discount_type}</td>
                  <td>{row.status}</td>
                  <td>{formatPrice(Number(row.spent_kobo))}</td>
                  <td>
                    <button
                      className="text-amber-300"
                      onClick={async () => {
                        await fetch('/api/admin/promotions', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: row.id, status: row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
                        })
                        void load()
                      }}
                    >
                      {row.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
