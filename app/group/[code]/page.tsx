'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useCart, cartLineKey, type CartItem } from '@/components/cart-context'
import { useFeatures } from '@/lib/use-features'

interface GItem { id: string; contributor_id: string; contributor_name: string; quantity: number; notes: string | null; menu_item_id: string; name: string; price_kobo: number; mine: boolean }
interface MenuItem { id: string; name: string; price_kobo: number; category: string }
interface GroupData { code: string; group_order_id: string; status: string; expires_at: string; is_host: boolean; host_id: string; split_enabled: boolean; funded: Record<string, boolean>; my_balance_kobo: number; my_food_kobo: number; vendor: { id: string; name: string }; items: GItem[]; menu: MenuItem[] }

interface Person { id: string; name: string; total: number; count: number; mine: boolean }
function groupByPerson(items: GItem[]): Person[] {
  const m = new Map<string, Person>()
  for (const it of items) {
    const e = m.get(it.contributor_id) ?? { id: it.contributor_id, name: it.contributor_name, total: 0, count: 0, mine: false }
    e.total += it.price_kobo * it.quantity
    e.count += it.quantity
    e.mine = e.mine || it.mine
    m.set(it.contributor_id, e)
  }
  return Array.from(m.values())
}

function remainingLabel(expiresAt: string, now: number): string | null {
  const ms = Date.parse(expiresAt) - now
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return 'closed'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

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
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Skip the background poll for a few seconds after a local change, so it can't
  // overwrite an optimistic edit (e.g. the split toggle) before the save lands.
  const lastMutate = useRef(0)

  // silent=true → background poll (no flicker, respects the mutation guard).
  // force=true → a mutation's own reconcile or a manual refresh (always applies).
  const load = useCallback(async (silent = false, force = false) => {
    if (silent && !force && Date.now() - lastMutate.current < 4000) return
    try {
      const res = await fetch(`/api/group-order/${code}`, { cache: 'no-store' })
      if (res.status === 401) { router.push(`/auth?next=/group/${code}`); return }
      const d = await res.json()
      // Closed (cancelled / expired) — flip the page to the closed message even on a silent poll.
      if (res.status === 410) { setData(null); setError(d.error ?? 'This group order is closed.'); return }
      if (!res.ok) { if (!silent) setError(d.error ?? 'Could not load group order.'); return }
      setData(d); setError('')
    } catch { if (!silent) setError('Connection error.') } finally { if (!silent) setLoading(false) }
  }, [code, router])

  // Initial load + a fast auto-refresh so everyone sees new items live.
  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 5000)
    return () => clearInterval(t)
  }, [load])

  const addItem = async (menu_item_id: string) => {
    setBusyId(menu_item_id); setError(''); lastMutate.current = Date.now()
    // Optimistic: show it instantly, then reconcile with the server silently.
    const m = data?.menu.find((x) => x.id === menu_item_id)
    if (data && m) {
      setData({ ...data, items: [...data.items, { id: `tmp-${menu_item_id}-${now}`, contributor_id: 'me', contributor_name: 'You', quantity: 1, notes: null, menu_item_id, name: m.name, price_kobo: m.price_kobo, mine: true }] })
    }
    try {
      const res = await fetch(`/api/group-order/${code}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_item_id, quantity: 1 }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setError(d.error ?? 'Could not add.')
      await load(true, true)
    } catch { setError('Connection error.'); await load(true, true) } finally { setBusyId('') }
  }

  const removeItem = async (id: string) => {
    setBusyId(id); lastMutate.current = Date.now()
    // Optimistic remove, then reconcile.
    if (data) setData({ ...data, items: data.items.filter((it) => it.id !== id) })
    try {
      await fetch(`/api/group-order/${code}/items?itemId=${id}`, { method: 'DELETE' })
      await load(true, true)
    } finally { setBusyId('') }
  }

  const removePerson = async (contributorId: string, name: string) => {
    if (!window.confirm(`Remove ${name} and all their items from the group?`)) return
    setBusyId(contributorId); lastMutate.current = Date.now()
    if (data) setData({ ...data, items: data.items.filter((it) => it.contributor_id !== contributorId) })
    try {
      await fetch(`/api/group-order/${code}/items?contributorId=${contributorId}`, { method: 'DELETE' })
      await load(true, true)
    } finally { setBusyId('') }
  }

  const toggleSplit = async () => {
    if (!data) return
    lastMutate.current = Date.now()
    const next = !data.split_enabled
    setData({ ...data, split_enabled: next }) // optimistic
    try {
      const res = await fetch(`/api/group-order/${code}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_enabled: next }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Could not update.'); await load(true, true) }
    } catch { setError('Connection error.'); await load(true, true) }
  }

  const cancelGroup = async () => {
    if (!window.confirm('Cancel this group order for everyone? The link stops working and everyone is notified. This can’t be undone.')) return
    setBusyId('cancel')
    try {
      const res = await fetch(`/api/group-order/${code}/cancel`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'Could not cancel.'); return }
      setData(null); setError('You cancelled this group order.')
    } catch { setError('Connection error.') } finally { setBusyId('') }
  }

  const share = () => {
    const url = `${window.location.origin}/group/${code}`
    const text = `Let's order food together on LumeX 🍲 Join my group order: ${url}`
    if (navigator.share) { navigator.share({ text, url }).catch(() => {}) ; return }
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const checkout = () => {
    if (!data) return
    // Warn the host if splitting and some members can't cover their share — those
    // are charged to the host now (members pay back / top up later).
    if (data.split_enabled) {
      const contribIds = Array.from(new Set(data.items.map((i) => i.contributor_id)))
      const unfunded = contribIds.filter((id) => id !== data.host_id && data.funded[id] === false)
      if (unfunded.length && !window.confirm(`${unfunded.length} friend(s) haven't put money in their LumeX wallet yet, so YOU'll pay their share now (they can pay you back). Continue?`)) return
    }
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
  if (loading) return (
    <Shell>
      <div className="space-y-3" aria-busy="true" aria-label="Loading group order">
        <div className="lx-skeleton rounded-2xl" style={{ height: 28, width: '60%' }} />
        <div className="lx-skeleton rounded-xl" style={{ height: 44 }} />
        <div className="lx-skeleton rounded-2xl" style={{ height: 96 }} />
        <div className="lx-skeleton rounded-2xl" style={{ height: 140 }} />
      </div>
    </Shell>
  )
  if (error && !data) return (
    <Shell>
      <div className="text-center py-16">
        <p className="text-3xl mb-3" aria-hidden="true">⚠️</p>
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => { setLoading(true); void load() }} className="lx-btn-amber inline-block mt-5 px-6 py-3 text-sm">Try again</button>
      </div>
    </Shell>
  )
  if (!data) return null

  const total = data.items.reduce((s, i) => s + i.price_kobo * i.quantity, 0)
  const closesIn = remainingLabel(data.expires_at, now)
  const expired = closesIn === 'closed'
  const people = groupByPerson(data.items)

  return (
    <Shell>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-white">Group order</h1>
        <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>{data.vendor.name}</span>
      </div>
      <p className="text-sm text-white/45 mb-3">Everyone adds their food here. {data.is_host ? 'You’re the host — you’ll pay for the whole order.' : 'The host pays for everyone; sort out your share with them.'}</p>

      <div className="rounded-xl px-3 py-2 mb-4 text-sm flex items-center gap-2"
        style={expired ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' } : { background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }}>
        <span aria-hidden="true">⏳</span>
        <span className={expired ? 'text-red-400' : 'text-white/70'}>
          {expired ? 'This group order has closed — start a new one.' : `Closes in ${closesIn} — add your items before then.`}
        </span>
      </div>

      {data.split_enabled && !data.is_host && data.my_food_kobo > 0 && data.my_balance_kobo < data.my_food_kobo && (
        <button onClick={() => router.push('/profile/wallet')} className="w-full rounded-2xl p-3 mb-4 text-left" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <p className="text-sm font-semibold" style={{ color: '#FCA5A5' }}>⚠️ Top up to pay your share</p>
          <p className="text-xs text-white/55 mt-0.5">Your wallet ({naira(data.my_balance_kobo)}) won’t cover your {naira(data.my_food_kobo)}+ share, so the host would pay it. Tap to add money and your share gets paid automatically.</p>
        </button>
      )}

      <button onClick={share} className="w-full mb-5 rounded-2xl py-3 text-sm font-semibold" style={{ background: '#25D366', color: '#fff' }}>
        {copied ? 'Link copied!' : 'Share group link with friends'}
      </button>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {/* People in the group + the bill split */}
      {people.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-4">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-2">People ({people.length}/3)</p>
          <div className="space-y-2">
            {people.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {p.name}{p.id === data.host_id ? ' · host' : ''}{p.mine ? ' (you)' : ''}
                  </p>
                  <p className="text-[11px] text-white/40">
                    {p.count} item{p.count === 1 ? '' : 's'} · {naira(p.total)} food
                    {data.split_enabled && p.id !== data.host_id && (
                      data.funded[p.id]
                        ? <span style={{ color: '#22C55E' }}> · ✅ can pay</span>
                        : <span style={{ color: '#F5A623' }}> · ⚠️ no wallet money</span>
                    )}
                  </p>
                </div>
                {data.is_host && p.id !== data.host_id && p.id !== 'me' && (
                  <button onClick={() => removePerson(p.id, p.name)} disabled={busyId === p.id}
                    className="text-xs text-red-400/80 hover:text-red-400 shrink-0 disabled:opacity-50">remove</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Host controls — always visible to the host (even before anyone adds food) */}
      {data.is_host && !expired && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-3">Host controls</p>
          <button onClick={toggleSplit} className="flex items-center gap-2 text-sm mb-2" aria-label="Toggle split the bill">
            <span className="relative w-10 h-6 rounded-full transition-colors shrink-0" style={{ background: data.split_enabled ? '#22C55E' : 'rgba(255,255,255,0.15)' }}>
              <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all" style={{ left: data.split_enabled ? 22 : 4 }} />
            </span>
            <span className="text-white/80 font-medium">Split the bill</span>
            <span className="text-white/40">{data.split_enabled ? 'on' : 'off'}</span>
          </button>
          <p className="text-[11px] text-white/35 mb-3">
            {data.split_enabled
              ? 'When you check out, each member’s share (their food + an equal share of fees) is charged to their LumeX wallet. If someone’s wallet is short, you cover them and they’re asked to pay you back.'
              : 'You’re treating everyone 🎁 Nobody is charged — you pay the whole bill.'}
          </p>
          <button onClick={cancelGroup} disabled={busyId === 'cancel'}
            className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
            {busyId === 'cancel' ? 'Cancelling…' : 'Cancel group order'}
          </button>
        </div>
      )}

      {/* Running list */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">In the basket ({data.items.length})</p>
          <button onClick={() => load(true, true)} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1" aria-label="Refresh">
            ↻ refresh
          </button>
        </div>
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
            <button onClick={() => addItem(m.id)} disabled={busyId === m.id || expired}
              className="shrink-0 rounded-lg px-4 text-xs font-semibold text-black disabled:opacity-50" style={{ background: '#F5A623', minHeight: 44 }}>
              {busyId === m.id ? '…' : '+ Add'}
            </button>
          </div>
        ))}
      </div>

      {/* Host checkout bar */}
      {data.is_host && data.items.length > 0 && !expired && (() => {
        // When splitting, the host can't check out until every friend has put
        // their share in their wallet (each pays their own — host never covers).
        const memberIds = people.filter((p) => p.id !== data.host_id).map((p) => p.id)
        const waiting = data.split_enabled && memberIds.some((id) => data.funded[id] === false)
        return (
          <div className="fixed bottom-0 left-0 right-0 px-4 pt-4" style={{ background: 'linear-gradient(to top, #0A0A0B, rgba(10,10,11,0.9))', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
            <div className="mx-auto max-w-md">
              <button onClick={checkout} disabled={waiting}
                className="w-full rounded-2xl py-4 text-sm font-bold text-black disabled:opacity-50" style={{ background: '#F5A623', minHeight: 52 }}>
                {waiting
                  ? 'Waiting for everyone to fund their share…'
                  : data.split_enabled
                    ? `Checkout · everyone pays their share · ${naira(total)}`
                    : `Checkout & pay for all · ${naira(total)}`}
              </button>
              {waiting && <p className="text-[11px] text-white/40 text-center mt-2">Each friend must add their share to their LumeX wallet first.</p>}
            </div>
          </div>
        )
      })()}
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
