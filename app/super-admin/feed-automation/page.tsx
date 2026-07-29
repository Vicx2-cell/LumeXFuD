'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Data = {
  config: {
    enabled: boolean
    vendorDailyLimit: number
    officialAreaWindowLimit: number
    duplicateTopicCooldownHours: number
    menuBatchWindowMinutes: number
    vendorReopenMinimumHours: number
    priceDropMinimumBps: number
    priceDropMinimumKobo: number
    backInStockMinimumOrders: number
    popularityMinimumOrders: number
    anonymityMinimumOrders: number
    orderAggregationHours: number
    affordabilityMaxItemKobo: number
    affordabilityMaxMealKobo: number
    collectionItemCount: number
    enabledPostTypes: string[]
  }
  failedJobs: Array<{ id: string; event_type: string; status: string; last_error: string | null }>
  audit: Array<{ id: string; action: string; reason: string; created_at: string }>
  templatePreviews: { vendor: string; official: string }
}
type Pin = { id: string; post_id: string; scope_type: string; scope_id: string | null; expires_at: string | null }

export default function FeedAutomationAdminPage() {
  const [data, setData] = useState<Data | null>(null)
  const [pins, setPins] = useState<Pin[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [postId, setPostId] = useState('')
  const [scopeType, setScopeType] = useState<'global' | 'city' | 'campus' | 'delivery_area'>('global')
  const [scopeId, setScopeId] = useState('')

  const load = useCallback(async () => {
    const [settings, pinResponse] = await Promise.all([fetch('/api/super-admin/feed-automation'), fetch('/api/super-admin/feed-pins')])
    const settingsJson = await settings.json()
    const pinsJson = await pinResponse.json()
    if (!settings.ok) throw new Error(settingsJson.error ?? 'Could not load feed automation')
    if (!pinResponse.ok) throw new Error(pinsJson.error ?? 'Could not load pins')
    setData(settingsJson)
    setPins(pinsJson.pins ?? [])
  }, [])

  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Load failed')) }, [load])

  async function saveEnabled(enabled: boolean) {
    setBusy(true)
    const response = await fetch('/api/super-admin/feed-automation', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    })
    const json = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) return setNotice(json.error ?? 'Could not save')
    setNotice(enabled ? 'Automation enabled' : 'Automation paused')
    await load()
  }

  async function saveThresholds(form: FormData) {
    const numeric = (name: string) => Number(form.get(name))
    const response = await fetch('/api/super-admin/feed-automation', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorDailyLimit: numeric('vendorDailyLimit'),
        officialAreaWindowLimit: numeric('officialAreaWindowLimit'),
        duplicateTopicCooldownHours: numeric('duplicateTopicCooldownHours'),
        menuBatchWindowMinutes: numeric('menuBatchWindowMinutes'),
        vendorReopenMinimumHours: numeric('vendorReopenMinimumHours'),
        priceDropMinimumBps: numeric('priceDropMinimumBps'),
        priceDropMinimumKobo: numeric('priceDropMinimumKobo'),
        backInStockMinimumOrders: numeric('backInStockMinimumOrders'),
        popularityMinimumOrders: numeric('popularityMinimumOrders'),
        anonymityMinimumOrders: numeric('anonymityMinimumOrders'),
        orderAggregationHours: numeric('orderAggregationHours'),
        affordabilityMaxItemKobo: numeric('affordabilityMaxItemKobo'),
        affordabilityMaxMealKobo: numeric('affordabilityMaxMealKobo'),
        collectionItemCount: numeric('collectionItemCount'),
      }),
    })
    const json = await response.json().catch(() => ({}))
    setNotice(response.ok ? 'Thresholds saved' : json.error ?? 'Could not save thresholds')
    if (response.ok) await load()
  }

  async function toggleType(type: string) {
    if (!data) return
    const enabled = new Set(data.config.enabledPostTypes)
    if (enabled.has(type)) enabled.delete(type)
    else enabled.add(type)
    const enabledPostTypes = Object.fromEntries([
      'vendor_welcome', 'new_menu_item', 'item_back_in_stock', 'price_drop', 'new_bundle',
      'popular_item', 'vendor_reopened', 'order_milestone', 'cheap_eats',
      'breakfast_collection', 'lunch_collection', 'evening_collection',
      'late_night_collection', 'new_on_lumex', 'popular_near_you', 'back_in_stock',
      'lumex_picks', 'order_activity_collection',
    ].map((entry) => [entry, enabled.has(entry)]))
    const response = await fetch('/api/super-admin/feed-automation', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabledPostTypes }),
    })
    const json = await response.json().catch(() => ({}))
    setNotice(response.ok ? `${type} updated` : json.error ?? 'Could not update post type')
    if (response.ok) await load()
  }

  async function action(body: Record<string, unknown>, endpoint = '/api/super-admin/feed-automation') {
    setBusy(true)
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await response.json().catch(() => ({}))
    setBusy(false)
    setNotice(response.ok ? 'Saved' : json.error ?? 'Action failed')
    if (response.ok) await load()
  }

  return (
    <main className="min-h-screen bg-[#08090c] px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <Link href="/super-admin" className="text-sm text-[#F5A623]">← Super admin</Link>
        <h1 className="mt-4 text-3xl font-bold">Feed automation control</h1>
        <p className="mt-2 text-sm text-white/55">Kill switch, deterministic previews, failed jobs, provenance, and official pins.</p>
        {notice && <p className="mt-4 rounded-xl bg-white/10 p-3 text-sm">{notice}</p>}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="font-semibold">Global kill switch</h2><p className="text-sm text-white/50">Defaults off. Checkout and payment never depend on this worker.</p></div>
            <button disabled={busy || !data} onClick={() => void saveEnabled(!data?.config.enabled)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${data?.config.enabled ? 'bg-red-500' : 'bg-[#F5A623] text-black'}`}>
              {data?.config.enabled ? 'Pause all' : 'Enable'}
            </button>
          </div>
          {data && <p className="mt-3 text-xs text-white/45">Vendor limit: {data.config.vendorDailyLimit}/day · Topic cooldown: {data.config.duplicateTopicCooldownHours}h · {data.config.enabledPostTypes.length} enabled types</p>}
        </section>
        {data && <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-semibold">Thresholds and frequency</h2>
          <form action={(form) => void saveThresholds(form)} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['vendorDailyLimit', 'Vendor posts/day'],
              ['officialAreaWindowLimit', 'Official posts/window'],
              ['duplicateTopicCooldownHours', 'Topic cooldown hours'],
              ['menuBatchWindowMinutes', 'Menu batch minutes'],
              ['vendorReopenMinimumHours', 'Reopen minimum hours'],
              ['priceDropMinimumBps', 'Price drop basis points'],
              ['priceDropMinimumKobo', 'Price drop minimum kobo'],
              ['backInStockMinimumOrders', 'Stock-return orders'],
              ['popularityMinimumOrders', 'Popularity orders'],
              ['anonymityMinimumOrders', 'Anonymity orders'],
              ['orderAggregationHours', 'Order aggregation hours'],
              ['affordabilityMaxItemKobo', 'Max item kobo'],
              ['affordabilityMaxMealKobo', 'Max meal kobo'],
              ['collectionItemCount', 'Collection item count'],
            ] as const).map(([key, label]) => <label key={key} className="text-xs text-white/55">{label}<input name={key} type="number" defaultValue={data.config[key]} className="mt-1 w-full rounded-xl bg-black/30 p-3 text-sm text-white" /></label>)}
            <button className="rounded-xl bg-[#F5A623] px-4 py-3 text-sm font-semibold text-black">Save thresholds</button>
          </form>
          <h3 className="mt-5 text-sm font-semibold">Automatic post types</h3>
          <div className="mt-2 flex flex-wrap gap-2">{[
            'vendor_welcome', 'new_menu_item', 'item_back_in_stock', 'price_drop', 'new_bundle',
            'popular_item', 'vendor_reopened', 'order_milestone', 'cheap_eats',
            'breakfast_collection', 'lunch_collection', 'evening_collection',
            'late_night_collection', 'new_on_lumex', 'popular_near_you', 'back_in_stock',
            'lumex_picks', 'order_activity_collection',
          ].map((type) => <button key={type} type="button" onClick={() => void toggleType(type)} className={`rounded-full px-3 py-1.5 text-xs ${data.config.enabledPostTypes.includes(type) ? 'bg-[#F5A623] text-black' : 'bg-white/10 text-white/55'}`}>{type}</button>)}</div>
        </section>}
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="font-semibold">Template previews</h2>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-xs">{data?.templatePreviews.vendor ?? 'Loading…'}</pre>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-xs">{data?.templatePreviews.official ?? 'Loading…'}</pre>
          </section>
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="font-semibold">Pin official post</h2>
            <input aria-label="Post ID" value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="Published official post UUID" className="mt-3 w-full rounded-xl bg-black/30 p-3 text-sm" />
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value as typeof scopeType)} className="mt-3 w-full rounded-xl bg-black/30 p-3 text-sm">
              <option value="global">Global</option><option value="city">City</option><option value="campus">Campus</option><option value="delivery_area">Delivery area</option>
            </select>
            {scopeType !== 'global' && <input aria-label="Scope ID" value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="Scope UUID" className="mt-3 w-full rounded-xl bg-black/30 p-3 text-sm" />}
            <button disabled={busy} onClick={() => void action({ action: 'pin', postId, scopeType, scopeId: scopeType === 'global' ? null : scopeId }, '/api/super-admin/feed-pins')} className="mt-3 rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black">Pin</button>
            <div className="mt-4 space-y-2">{pins.map((pin) => <div key={pin.id} className="flex items-center justify-between rounded-xl bg-black/20 p-3 text-xs"><span>{pin.scope_type}: {pin.post_id.slice(0, 8)}…</span><button onClick={() => void action({ action: 'unpin', pinId: pin.id }, '/api/super-admin/feed-pins')} className="text-red-300">Unpin</button></div>)}</div>
          </section>
        </div>
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-semibold">Failed generation jobs</h2>
          <div className="mt-3 space-y-2">{data?.failedJobs.length ? data.failedJobs.map((job) => <div key={job.id} className="flex items-start justify-between gap-3 rounded-xl bg-black/20 p-3 text-xs"><span><b>{job.event_type}</b> · {job.status}<br />{job.last_error}</span><button onClick={() => void action({ action: 'retry_job', jobId: job.id })} className="text-[#F5A623]">Retry idempotently</button></div>) : <p className="text-sm text-white/45">No failed jobs.</p>}</div>
        </section>
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-semibold">Recent provenance audit</h2>
          <div className="mt-3 space-y-2">{data?.audit.slice(0, 25).map((row) => <p key={row.id} className="text-xs text-white/55"><b className="text-white/80">{row.action}</b> · {row.reason}</p>)}</div>
        </section>
      </div>
    </main>
  )
}
