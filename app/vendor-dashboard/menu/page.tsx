'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'

const CATEGORIES = ['RICE', 'PROTEIN', 'DRINKS', 'SNACKS', 'OTHER'] as const
type Category = (typeof CATEGORIES)[number]

interface Addon { id?: string; name: string; price_kobo: number; is_available?: boolean }
interface MenuItem {
  id: string
  name: string
  description: string | null
  price_kobo: number
  image_url: string | null
  category: string
  is_available: boolean
  sold_out_until: string | null
  prep_time_minutes: number | null
  display_order: number
  addons: Addon[]
}

interface FormAddon { name: string; price: string }
interface FormState {
  name: string
  price: string
  category: Category
  description: string
  image_url: string
  is_available: boolean
  prep: string // per-item prep minutes; '' = use the shop's base time
  addons: FormAddon[]
}

const emptyForm: FormState = {
  name: '', price: '', category: 'RICE', description: '', image_url: '', is_available: true, prep: '', addons: [],
}

export default function VendorMenuPage() {
  const router = useRouter()
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [describing, setDescribing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/vendor/menu')
    if (res.status === 401) { router.push('/auth'); return }
    if (res.status === 403) { router.push('/vendor-dashboard'); return }
    if (res.ok) {
      const d = await res.json() as { items: MenuItem[] }
      setItems(d.items)
    }
    setLoading(false)
  }, [router])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setShowForm(true)
  }

  function openEdit(item: MenuItem) {
    setEditingId(item.id)
    setForm({
      name: item.name,
      price: String(Math.round(item.price_kobo / 100)),
      category: (CATEGORIES.includes(item.category as Category) ? item.category : 'OTHER') as Category,
      description: item.description ?? '',
      image_url: item.image_url ?? '',
      is_available: item.is_available,
      prep: item.prep_time_minutes != null ? String(item.prep_time_minutes) : '',
      addons: item.addons.map((a) => ({ name: a.name, price: String(Math.round(a.price_kobo / 100)) })),
    })
    setError('')
    setShowForm(true)
  }

  async function uploadImage(file: File) {
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd })
      const d = await res.json() as { url?: string; error?: string }
      if (!res.ok || !d.url) { setError(d.error ?? 'Upload failed'); return }
      setForm((f) => ({ ...f, image_url: d.url! }))
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Draft a description with AI from the item name (+ its photo, if uploaded).
  // Fills the field; the vendor still reviews/edits before saving.
  async function describeWithAI() {
    if (!form.name.trim()) { setError('Add the item name first'); return }
    setDescribing(true)
    setError('')
    try {
      const res = await fetch('/api/vendor-ai/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), category: form.category, image_url: form.image_url || undefined }),
      })
      const d = await res.json() as { description?: string; error?: string }
      if (!res.ok || !d.description) { setError(d.error ?? 'Could not write a description'); return }
      setForm((f) => ({ ...f, description: d.description! }))
    } catch {
      setError('Network error')
    } finally {
      setDescribing(false)
    }
  }

  async function save() {
    const priceNaira = parseInt(form.price, 10)
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!Number.isFinite(priceNaira) || priceNaira < 1) { setError('Enter a valid price'); return }
    for (const a of form.addons) {
      if (!a.name.trim()) { setError('Every add-on needs a name'); return }
      if (!Number.isFinite(parseInt(a.price, 10)) || parseInt(a.price, 10) < 0) { setError('Every add-on needs a valid price'); return }
    }

    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      price_naira: priceNaira,
      category: form.category,
      description: form.description.trim() || undefined,
      image_url: form.image_url || undefined,
      is_available: form.is_available,
      prep_time_minutes: form.prep.trim() === '' ? null : parseInt(form.prep, 10),
      addons: form.addons.map((a) => ({ name: a.name.trim(), price_naira: parseInt(a.price, 10) })),
    }
    try {
      const res = editingId
        ? await fetch(`/api/vendor/menu/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/vendor/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await res.json() as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Save failed'); return }
      setShowForm(false)
      await load()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleAvailable(item: MenuItem) {
    const next = !item.is_available
    // Re-enabling also cancels any pending "sold out today" timer (matches the API).
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, is_available: next, sold_out_until: next ? null : i.sold_out_until } : i))
    await fetch(`/api/vendor/menu/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: next }),
    })
  }

  // One-tap "sold out for today" — hides the dish and auto-restores at the next
  // Lagos midnight (server sets the exact time; this is an optimistic local mark).
  async function soldOutToday(item: MenuItem) {
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, is_available: false, sold_out_until: new Date(Date.now() + 86_400_000).toISOString() } : i))
    await fetch(`/api/vendor/menu/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sold_out_today: true }),
    })
  }

  async function removeItem(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"?`)) return
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await fetch(`/api/vendor/menu/${item.id}`, { method: 'DELETE' })
  }

  return (
    <div className="lx-page pb-28">
      {/* Header */}
      <div className="lx-topbar sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/vendor-dashboard')} aria-label="Back to dashboard" className="lx-tap w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <h1 className="font-semibold flex-1 truncate">My Menu</h1>
          <button onClick={openAdd} className="lx-btn-amber lx-tap text-xs px-4 min-h-[44px] shrink-0">+ Add food</button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl lx-skeleton" />)}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🍽️</p>
            <p className="text-white/40 text-sm mb-4">No foods yet. Add your first item.</p>
            <button onClick={openAdd} className="lx-btn-amber px-5 py-3">+ Add food</button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="glass-thin flex gap-3 rounded-2xl p-3" style={{ opacity: item.is_available ? 1 : 0.55 }}>
                <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-white/5">
                  {item.image_url
                    ? <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="64px" />
                    : <div className="w-full h-full flex items-center justify-center text-xl opacity-20">🍽️</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="lx-amber text-sm font-semibold mt-0.5">{formatPrice(item.price_kobo)}</p>
                  <p className="text-xs text-white/30 mt-0.5 truncate">{item.category}{item.prep_time_minutes != null ? ` · ${item.prep_time_minutes} min` : ''}{item.addons.length > 0 ? ` · ${item.addons.length} add-on${item.addons.length === 1 ? '' : 's'}` : ''}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5 -ml-1.5">
                    <button onClick={() => openEdit(item)} className="lx-tap lx-amber text-xs font-medium px-2.5 py-1.5 min-h-[36px] rounded-lg">Edit</button>
                    {item.is_available && (
                      <button onClick={() => soldOutToday(item)} className="lx-tap text-xs font-medium px-2.5 py-1.5 min-h-[36px] rounded-lg" style={{ color: '#f59e0b' }}>Sold out today</button>
                    )}
                    <button onClick={() => removeItem(item)} className="lx-tap text-xs font-medium text-red-400 px-2.5 py-1.5 min-h-[36px] rounded-lg">Delete</button>
                  </div>
                  {!item.is_available && item.sold_out_until && (
                    <p className="text-[11px] mt-1" style={{ color: '#f59e0b' }}>🕛 Sold out — auto-returns tomorrow</p>
                  )}
                </div>
                <button onClick={() => toggleAvailable(item)} aria-pressed={item.is_available} className="lx-tap shrink-0 self-start text-xs font-semibold px-3 py-1.5 min-h-[36px] rounded-full"
                  style={{ background: item.is_available ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.08)', color: item.is_available ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>
                  {item.is_available ? 'Available' : 'Hidden'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit sheet */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => !saving && setShowForm(false)}>
          <div className="w-full max-w-lg rounded-t-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" style={{ background: '#111113', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">{editingId ? 'Edit food' : 'Add food'}</h3>
              <button onClick={() => setShowForm(false)} className="text-white/40 text-sm">Close</button>
            </div>

            {/* Photo */}
            <div className="flex items-center gap-3">
              <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-white/5">
                {form.image_url
                  ? <Image src={form.image_url} alt="" fill className="object-cover" sizes="80px" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl opacity-20">🍽️</div>}
              </div>
              <label className="lx-tap text-sm px-4 min-h-[44px] inline-flex items-center rounded-xl cursor-pointer" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)' }}>
                {uploading ? 'Uploading…' : form.image_url ? 'Change photo' : 'Add photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f) }} />
              </label>
            </div>

            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jollof Rice" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (₦)">
                <input value={form.price} inputMode="numeric" onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9]/g, '') })} placeholder="1500" className={inputCls} />
              </Field>
              <Field label="Category">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Prep time (min)">
              <input value={form.prep} inputMode="numeric" onChange={(e) => setForm({ ...form, prep: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })} placeholder="How long this dish takes — leave blank to use your shop default" className={inputCls} />
            </Field>
            <div className="block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.18em] text-white/40">Description (optional)</span>
                <button type="button" onClick={describeWithAI} disabled={describing || !form.name.trim()}
                  className="lx-amber text-xs font-semibold disabled:opacity-40">
                  {describing ? 'Writing…' : (form.image_url ? '✨ Write from photo' : '✨ Write with AI')}
                </button>
              </div>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 300) })} rows={2} placeholder="Smoky party jollof with…" className={inputCls} />
            </div>

            {/* Add-ons */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-[0.18em] text-white/40">Add-ons (optional)</span>
                <button onClick={() => setForm({ ...form, addons: [...form.addons, { name: '', price: '' }] })} className="lx-amber text-xs font-semibold">+ Add-on</button>
              </div>
              <div className="space-y-2">
                {form.addons.map((a, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input value={a.name} onChange={(e) => { const next = [...form.addons]; next[i] = { ...a, name: e.target.value }; setForm({ ...form, addons: next }) }} placeholder="Extra meat" className={addonInputCls + ' flex-1 min-w-0'} />
                    <input value={a.price} inputMode="numeric" onChange={(e) => { const next = [...form.addons]; next[i] = { ...a, price: e.target.value.replace(/[^0-9]/g, '') }; setForm({ ...form, addons: next }) }} placeholder="₦300" className={addonInputCls + ' w-20 shrink-0'} />
                    <button type="button" aria-label="Remove add-on" onClick={() => setForm({ ...form, addons: form.addons.filter((_, j) => j !== i) })} className="lx-tap text-red-400 text-lg shrink-0 w-9 h-9 flex items-center justify-center rounded-lg">×</button>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 py-1">
              <input type="checkbox" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} className="w-4 h-4 accent-amber-500" />
              <span className="text-sm text-white/70">Available now</span>
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button onClick={save} disabled={saving || uploading} className="lx-btn-amber w-full py-4 disabled:opacity-50">
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to menu'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// text-base (16px) on inputs prevents iOS Safari from auto-zooming on focus.
const inputCls = 'lx-field w-full px-3 py-2.5 text-base outline-none'
// Same styling minus w-full, for the flex add-on rows (w-full would fight flex-1/w-20).
const addonInputCls = 'lx-field px-3 py-2.5 text-base outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-white/40">{label}</span>
      {children}
    </label>
  )
}
