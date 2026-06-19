'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useCart, cartLineKey, type CartItem } from '@/components/cart-context'
import { useFeatures } from '@/lib/use-features'

interface GItem { id: string; contributor_id: string; contributor_name: string; quantity: number; notes: string | null; menu_item_id: string; name: string; price_kobo: number; mine: boolean }
interface MenuItem { id: string; name: string; price_kobo: number; category: string }
interface GroupData { code: string; group_order_id: string; status: string; is_host: boolean; vendor: { id: string; name: string }; items: GItem[]; menu: MenuItem[] }

const naira = (k: number) => '₦' + (k / 100).toLocaleString()

export default function GroupOrderPage() {
  const params = useParams<{ code: string }>()
  const code = String(params.code ?? '').toUpperCase()
  const router = useRouter()
  const { replaceCart } = useCart()
  const features = useFeatures()

  const [data, setData] = useState<GroupData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/group-order/${code}`, { cache: 'no-store' })
      if (res.status === 401) { router.push(`/auth?next=/group/${code}`); return }
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not load group order.'); return }
      setData(d)
    } catch { setError('Connection error.') } finally { setLoading(false) }
  }, [code, router])

  useEffect(() => { load() }, [load])

  const addItem = async (menu_item_id: string) => {
    setBusyId(menu_item_id)
    try {
      const res = await fetch(`/api/group-order/${code}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_item_id, quantity: 1 }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not add.'); return }
      await load()
    } catch { setError('Connection error.') } finally { setBusyId('') }
  }

  const removeItem = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/group-order/${code}/items?itemId=${id}`, { method: 'DELETE' })
      if (res.ok) await load()
    } finally { setBusyId('') }
  }

  const share = () => {
    const url = `${window.location.origin}/group/${code}`
    const text = `Let's order food together on LumeX 🍲 Join my group order: ${url}`
    if (navigator.share) { navigator.share({ text, url }).catch(() => {}) ; return }
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const checkout = () => {
    if (!data) return
    // Merge everyone's items by menu item (v1 has no add-ons) and hand the combined
    // basket to the normal cart/checkout — the host pays the whole bill there, so
    // it reuses the existing order + payment flow exactly.
    const lines = new Map<string, CartItem>()
    for (const it of data.items) {
      const key = cartLineKey(it.menu_item_id, [])
      const existing = lines.get(key)
      if (existing) existing.quantity = Math.min(existing.quantity + it.quantity, 20)
      else lines.set(key, { id: key, menu_item_id: it.menu_item_id, name: it.name, price_kobo: it.price_kobo, quantity: Math.min(it.quantity, 20), addons: [] })
    }
    if (lines.size === 0) { setError('Add some items first.'); return }
    // Tell the cart this checkout finalizes a group order, so /api/orders links it
    // and notifies everyone once paid.
    try { sessionStorage.setItem('lx_group_id', data.group_order_id) } catch { /* ignore */ }
    replaceCart({ vendor_id: data.vendor.id, vendor_name: data.vendor.name, items: Array.from(lines.values()) })
    router.push('/cart')
  }

  if (features.group_orders === false) return <Shell><p className="text-white/50 text-sm">Group ordering isn’t available right now.</p></Shell>
  if (loading) return <Shell><p className="text-white/40 text-sm">Loading group order…</p></Shell>
  if (error && !data) return <Shell><p className="text-red-400 text-sm">{error}</p></Shell>
  if (!data) return null

  const total = data.items.reduce((s, i) => s + i.price_kobo * i.quantity, 0)

  return (
    <Shell>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-white">Group order</h1>
        <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>{data.vendor.name}</span>
      </div>
      <p className="text-sm text-white/45 mb-4">Everyone adds their food here. {data.is_host ? 'You’re the host — you’ll pay for the whole order.' : 'The host pays for everyone; sort out your share with them.'}</p>

      <button onClick={share} className="w-full mb-5 rounded-2xl py-3 text-sm font-semibold" style={{ background: '#25D366', color: '#fff' }}>
        {copied ? 'Link copied!' : 'Share group link with friends'}
      </button>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {/* Running list */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-2">In the basket ({data.items.length})</p>
        {data.items.length === 0 ? (
          <p className="text-sm text-white/40">Nothing yet — add from the menu below.</p>
        ) : (
          <div className="space-y-2">
            {data.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{it.quantity}× {it.name}</p>
                  <p className="text-[11px] text-white/40">{it.contributor_name}{it.mine ? ' (you)' : ''} · {naira(it.price_kobo * it.quantity)}</p>
                </div>
                {(it.mine || data.is_host) && (
                  <button onClick={() => removeItem(it.id)} disabled={busyId === it.id}
                    className="text-xs text-red-400/80 hover:text-red-400 shrink-0 disabled:opacity-50">remove</button>
                )}
              </div>
            ))}
            <div className="pt-2 mt-1 border-t border-white/10 flex justify-between text-sm">
              <span className="text-white/50">Food subtotal</span>
              <span className="text-white font-semibold">{naira(total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Menu picker */}
      <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-2">Add from menu</p>
      <div className="space-y-2 mb-24">
        {data.menu.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#111113] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{m.name}</p>
              <p className="text-[11px] text-white/40">{naira(m.price_kobo)}</p>
            </div>
            <button onClick={() => addItem(m.id)} disabled={busyId === m.id}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50" style={{ background: '#F5A623' }}>
              {busyId === m.id ? '…' : '+ Add'}
            </button>
          </div>
        ))}
      </div>

      {/* Host checkout bar */}
      {data.is_host && data.items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4" style={{ background: 'linear-gradient(to top, #0A0A0B, rgba(10,10,11,0.9))' }}>
          <div className="mx-auto max-w-md">
            <button onClick={checkout} className="w-full rounded-2xl py-4 text-sm font-bold text-black" style={{ background: '#F5A623', minHeight: 52 }}>
              Checkout &amp; pay for all · {naira(total)}
            </button>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh px-5 py-10" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  )
}
