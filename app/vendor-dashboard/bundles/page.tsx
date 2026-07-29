'use client'

import { useCallback, useEffect, useState } from 'react'

type MenuItem = { id: string; name: string; is_available: boolean }
type Bundle = { id: string; name: string; price_kobo: number; is_active: boolean }

export default function VendorBundlesPage() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const [menuResponse, bundleResponse] = await Promise.all([fetch('/api/vendor/menu'), fetch('/api/vendor/bundles')])
    const menu = await menuResponse.json()
    const bundleData = await bundleResponse.json()
    if (!menuResponse.ok || !bundleResponse.ok) throw new Error(menu.error ?? bundleData.error ?? 'Could not load bundles')
    setItems((menu.items ?? []).filter((item: MenuItem) => item.is_available))
    setBundles(bundleData.bundles ?? [])
  }, [])
  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Load failed')) }, [load])
  async function create(publish: boolean) {
    const response = await fetch('/api/vendor/bundles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, priceNaira: Number(price), primaryMenuItemId: selected[0],
        items: selected.map((menuItemId) => ({ menuItemId, quantity: 1 })), publish,
      }),
    })
    const data = await response.json().catch(() => ({}))
    setNotice(response.ok ? (publish ? 'Bundle published' : 'Bundle saved as draft') : data.error ?? 'Could not create bundle')
    if (response.ok) { setName(''); setPrice(''); setSelected([]); await load() }
  }
  async function update(id: string, body: Record<string, unknown>, method = 'PATCH') {
    const response = await fetch(`/api/vendor/bundles/${id}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    setNotice(response.ok ? 'Bundle updated' : data.error ?? 'Could not update bundle')
    if (response.ok) await load()
  }
  return <main className="p-5 text-white">
    <h1 className="text-2xl font-bold">Menu bundles</h1>
    <p className="mt-2 text-sm text-white/55">Create a menu item for the complete bundle first, select it as the primary item, and use that same price. This keeps the advertised CTA and checkout total identical.</p>
    {notice && <p className="mt-4 rounded-xl bg-white/10 p-3 text-sm">{notice}</p>}
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <input aria-label="Bundle name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bundle name" className="rounded-xl bg-black/30 p-3 text-sm" />
        <input aria-label="Bundle price in naira" value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="1" placeholder="Price in naira" className="rounded-xl bg-black/30 p-3 text-sm" />
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/45">Included menu items (first selected is the primary CTA)</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{items.map((item) => <label key={item.id} className="flex gap-2 rounded-xl bg-black/20 p-3 text-sm"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />{item.name}</label>)}</div>
      <div className="mt-4 flex gap-2"><button onClick={() => void create(false)} className="rounded-full bg-white/10 px-4 py-2 text-sm">Save draft</button><button onClick={() => void create(true)} className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black">Publish bundle</button></div>
    </section>
    <section className="mt-6 space-y-3">{bundles.map((bundle) => <article key={bundle.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
      <div><h2 className="font-semibold">{bundle.name}</h2><p className="text-xs text-white/45">₦{(bundle.price_kobo / 100).toLocaleString()} · {bundle.is_active ? 'Published' : 'Draft/inactive'}</p></div>
      <div className="flex gap-3 text-xs">{!bundle.is_active && <button onClick={() => void update(bundle.id, { active: true })} className="text-[#F5A623]">Publish</button>}<button onClick={() => void update(bundle.id, {}, 'DELETE')} className="text-red-300">Archive</button></div>
    </article>)}</section>
  </main>
}
