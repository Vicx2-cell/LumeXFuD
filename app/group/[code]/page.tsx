'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Check, Clock, Copy, Lock, MessageCircle, RefreshCw, Share2, ShoppingCart, Users, X } from 'lucide-react'
import { useCart, cartLineKey } from '@/components/cart-context'
import { useFeatures } from '@/lib/use-features'
import { groupOrderAddonLabel, groupOrderLineTotalKobo, type GroupOrderAddonSnapshot } from '@/lib/group-order-addons'

interface MenuAddon extends GroupOrderAddonSnapshot { is_required: boolean }
interface MenuItem { id: string; name: string; price_kobo: number; category: string; addons: MenuAddon[] }
interface GroupItem {
  id: string
  participant_id: string | null
  contributor_id: string
  contributor_name: string
  quantity: number
  notes: string | null
  menu_item_id: string
  name: string
  price_kobo: number
  current_price_kobo: number
  addons: GroupOrderAddonSnapshot[]
  version: number
  mine: boolean
  available: boolean
}
interface Participant { id: string; display_name: string; status: string; subtotal_kobo: number; mine: boolean; last_seen_at: string }
interface ReconciliationIssue { type: string; participant_id?: string; item_id?: string; message: string; previous_kobo?: number; current_kobo?: number }
interface GroupData {
  code: string
  group_order_id: string
  name: string
  status: string
  expires_at: string
  delivery_type: string
  delivery_address: string | null
  per_person_budget_kobo: number | null
  participant_limit: number
  shared_note: string | null
  organizer: { id: string; name: string }
  vendor: { id: string; name: string; status: string }
  version: number
  reconciliation: ReconciliationIssue[]
  join_required: boolean
  is_host: boolean
  participant_id?: string | null
  participant_status?: string | null
  participants?: Participant[]
  items?: GroupItem[]
  menu?: MenuItem[]
}

const money = (kobo: number) => `NGN ${(kobo / 100).toLocaleString('en-NG')}`

export default function GroupOrderPage() {
  const params = useParams<{ code: string }>()
  const code = String(params.code ?? '').toUpperCase()
  const router = useRouter()
  const features = useFeatures()
  const { replaceCart } = useCart()
  const [data, setData] = useState<GroupData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [joinName, setJoinName] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [picker, setPicker] = useState<{ menu: MenuItem; editing?: GroupItem } | null>(null)
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([])
  const [itemNote, setItemNote] = useState('')
  const lastMutation = useRef(0)
  const pendingClientIds = useRef(new Map<string, string>())

  const load = useCallback(async (silent = false, force = false) => {
    if (silent && !force && Date.now() - lastMutation.current < 3000) return
    try {
      const response = await fetch(`/api/group-order/${code}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as GroupData & { error?: string }
      if (!response.ok) {
        if (!silent) setError(payload?.error ?? 'Could not load the group order.')
        return
      }
      setData(payload)
      setError('')
    } catch {
      if (!silent) setError('Connection lost. Your saved contribution is still safe; retry when online.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [code])

  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => void load(true), 5000)
    const clock = window.setInterval(() => setNow(Date.now()), 30000)
    const reconnect = () => void load(true, true)
    window.addEventListener('online', reconnect)
    return () => {
      window.clearInterval(refresh)
      window.clearInterval(clock)
      window.removeEventListener('online', reconnect)
    }
  }, [load])

  const items = data?.items ?? []
  const participants = data?.participants ?? []
  const total = items.reduce((sum, item) => sum + groupOrderLineTotalKobo(item), 0)
  const editable = data?.status === 'OPEN' && Date.parse(data.expires_at) > now
  const remaining = data ? remainingLabel(data.expires_at, now) : ''
  const myItems = items.filter((item) => item.mine)
  const requiredAddons = picker?.menu.addons.filter((addon) => addon.is_required) ?? []
  const optionalAddons = picker?.menu.addons.filter((addon) => !addon.is_required) ?? []
  const requiredComplete = requiredAddons.length === 0 || requiredAddons.filter((addon) => selectedAddonIds.includes(addon.id)).length === 1

  async function joinGroup() {
    if (joinName.trim().length < 2) return
    setBusy('join')
    try {
      const response = await fetch(`/api/group-order/${code}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: joinName.trim() }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) { setError(payload.error ?? 'Could not join.'); return }
      await load(false, true)
    } catch { setError('Connection lost. Try joining again.') } finally { setBusy('') }
  }

  function openPicker(menu: MenuItem, editing?: GroupItem) {
    setPicker({ menu, editing })
    setSelectedAddonIds(editing?.addons.map((addon) => addon.id) ?? [])
    setItemNote(editing?.notes ?? '')
  }

  function toggleAddon(addon: MenuAddon) {
    setSelectedAddonIds((current) => {
      if (addon.is_required) {
        const requiredIds = new Set(requiredAddons.map((choice) => choice.id))
        return [...current.filter((id) => !requiredIds.has(id)), addon.id]
      }
      return current.includes(addon.id) ? current.filter((id) => id !== addon.id) : [...current, addon.id]
    })
  }

  async function savePicker() {
    if (!picker || !requiredComplete) return
    const signature = `${picker.menu.id}:${selectedAddonIds.slice().sort().join(',')}:${itemNote}`
    const clientItemId = pendingClientIds.current.get(signature) ?? crypto.randomUUID()
    pendingClientIds.current.set(signature, clientItemId)
    setBusy(picker.editing?.id ?? picker.menu.id)
    lastMutation.current = Date.now()
    try {
      const response = await fetch(`/api/group-order/${code}/items`, {
        method: picker.editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(picker.editing ? {
          item_id: picker.editing.id,
          expected_version: picker.editing.version,
          quantity: picker.editing.quantity,
          notes: itemNote.trim() || null,
          addons: selectedAddonIds,
        } : {
          client_item_id: clientItemId,
          menu_item_id: picker.menu.id,
          quantity: 1,
          notes: itemNote.trim() || undefined,
          addons: selectedAddonIds,
        }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) { setError(payload.error ?? 'Could not save your contribution.'); await load(true, true); return }
      pendingClientIds.current.delete(signature)
      setPicker(null)
      await load(true, true)
    } catch {
      setError('Connection lost. Retry uses the same save key, so the item will not duplicate.')
    } finally { setBusy('') }
  }

  async function changeQuantity(item: GroupItem, quantity: number) {
    if (quantity < 1 || quantity > 20) return
    setBusy(item.id)
    try {
      const response = await fetch(`/api/group-order/${code}/items`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, expected_version: item.version, quantity, notes: item.notes, addons: item.addons.map((addon) => addon.id) }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) setError(payload.error ?? 'Could not update quantity.')
      await load(true, true)
    } finally { setBusy('') }
  }

  async function removeItem(itemId: string) {
    setBusy(itemId)
    try {
      const response = await fetch(`/api/group-order/${code}/items?itemId=${itemId}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) setError(payload.error ?? 'Could not remove item.')
      await load(true, true)
    } finally { setBusy('') }
  }

  async function removeParticipant(participant: Participant) {
    if (!window.confirm(`Remove ${participant.display_name} and their contribution?`)) return
    setBusy(participant.id)
    const response = await fetch(`/api/group-order/${code}/items?participantId=${participant.id}`, { method: 'DELETE' })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) setError(payload.error ?? 'Could not remove participant.')
    await load(true, true)
    setBusy('')
  }

  async function setReady(ready: boolean) {
    setBusy('ready')
    const response = await fetch(`/api/group-order/${code}/ready`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ready }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) setError(payload.error ?? 'Could not update readiness.')
    await load(true, true)
    setBusy('')
  }

  async function lockGroup(action: 'lock' | 'unlock') {
    if (!data) return
    setBusy(action)
    const response = await fetch(`/api/group-order/${code}/lock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expected_version: data.version }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) setError(payload.error ?? 'Could not update the group lock.')
    await load(true, true)
    setBusy('')
  }

  async function continueToCheckout() {
    if (!data || data.reconciliation.length) return
    setBusy('checkout')
    const response = await fetch(`/api/group-order/${code}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_version: data.version }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) { setError(payload.error ?? 'Could not continue to checkout.'); setBusy(''); return }

    const lines = items.map((item) => {
      const key = `${cartLineKey(item.menu_item_id, item.addons)}|group:${item.id}`
      return { id: key, menu_item_id: item.menu_item_id, name: item.name, price_kobo: item.current_price_kobo, quantity: item.quantity, addons: item.addons, special_instructions: item.notes ?? undefined }
    })
    sessionStorage.setItem('lx_group_id', data.group_order_id)
    sessionStorage.setItem('lx_group_delivery_type', data.delivery_type)
    if (data.delivery_address) sessionStorage.setItem('lx_prefill_address', data.delivery_address)
    replaceCart({ vendor_id: data.vendor.id, vendor_name: data.vendor.name, items: lines })
    router.push('/cart')
  }

  async function cancelGroup() {
    if (!window.confirm('Cancel this group order for everyone?')) return
    setBusy('cancel')
    const response = await fetch(`/api/group-order/${code}/cancel`, { method: 'POST' })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) setError(payload.error ?? 'Could not cancel the group.')
    await load(true, true)
    setBusy('')
  }

  async function shareGroup() {
    const url = `${window.location.origin}/group/${code}`
    if (navigator.share) { await navigator.share({ title: data?.name ?? 'LumeX group order', url }).catch(() => {}) ; return }
    await navigator.clipboard.writeText(url)
    setError('Group link copied.')
  }

  async function copyGroup() {
    await navigator.clipboard.writeText(`${window.location.origin}/group/${code}`)
    setError('Group link copied.')
  }

  function shareWhatsApp() {
    const url = `${window.location.origin}/group/${code}`
    window.open(`https://wa.me/?text=${encodeURIComponent(`Join ${data?.name ?? 'my group order'} on LumeX: ${url}`)}`, '_blank', 'noopener,noreferrer')
  }

  if (features.group_orders === false) return <Shell><Notice>Group ordering is unavailable right now.</Notice></Shell>
  if (loading) return <Shell><Loading /></Shell>
  if (!data) return <Shell><Notice tone="error">{error || 'Group order not found.'}</Notice></Shell>

  if (data.join_required) return (
    <Shell>
      <GroupHeader data={data} remaining={remaining} onShare={shareGroup} onCopy={copyGroup} onWhatsApp={shareWhatsApp} />
      <section className="lx-surface mt-5 space-y-4 p-4">
        <div><h2 className="text-base font-semibold">Join this group</h2><p className="mt-1 text-xs text-white/50">Use a name the organizer will recognize. No permanent account is required.</p></div>
        <label className="block text-xs text-white/60" htmlFor="participant-name">Your name</label>
        <input id="participant-name" value={joinName} onChange={(event) => setJoinName(event.target.value.slice(0, 60))} className="lx-field w-full px-4 py-3" autoComplete="name" />
        {error && <Notice tone="error">{error}</Notice>}
        <button onClick={joinGroup} disabled={busy === 'join' || joinName.trim().length < 2 || !editable} className="lx-btn-amber min-h-12 w-full disabled:opacity-50">{busy === 'join' ? 'Joining...' : 'Join group'}</button>
      </section>
    </Shell>
  )

  return (
    <Shell>
      {picker && <ProductPicker picker={picker} selected={selectedAddonIds} note={itemNote} required={requiredAddons} optional={optionalAddons} complete={requiredComplete} busy={busy !== ''} onToggle={toggleAddon} onNote={setItemNote} onClose={() => setPicker(null)} onSave={savePicker} />}
      <GroupHeader data={data} remaining={remaining} onShare={shareGroup} onCopy={copyGroup} onWhatsApp={shareWhatsApp} />
      {error && <div className="mt-4"><Notice tone={error.includes('copied') ? 'default' : 'error'}>{error}</Notice></div>}

      <section className="mt-5 grid gap-3 sm:grid-cols-2">
        <Info label="Destination" value={`${data.delivery_type} - ${data.delivery_address ?? 'Not set'}`} />
        <Info label="Budget" value={data.per_person_budget_kobo ? `${money(data.per_person_budget_kobo)} per person` : 'No per-person cap'} />
      </section>
      {data.shared_note && <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/65">{data.shared_note}</p>}

      <section className="lx-surface mt-5 p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Participants ({participants.filter((p) => p.status !== 'REMOVED').length}/{data.participant_limit})</h2><Users className="h-4 w-4 text-white/40" /></div>
        <div className="mt-3 space-y-2">
          {participants.map((participant) => (
            <div key={participant.id} className="flex min-h-12 items-center justify-between gap-3 border-t border-white/8 pt-2 first:border-0 first:pt-0">
              <div className="min-w-0"><p className="truncate text-sm">{participant.display_name}{participant.mine ? ' (you)' : ''}</p><p className="text-xs text-white/45">{participant.status.toLowerCase()} - {money(participant.subtotal_kobo)}</p></div>
              {participant.status === 'READY' && <Check className="h-4 w-4 text-green-400" />}
              {data.is_host && !participant.mine && participant.status !== 'REMOVED' && <button onClick={() => removeParticipant(participant)} disabled={busy === participant.id} className="min-h-11 px-2 text-xs text-red-300">Remove</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="lx-surface mt-5 p-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Contributions</h2><button onClick={() => void load(true, true)} className="flex min-h-11 items-center gap-1 px-2 text-xs text-white/50"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div>
        {items.length === 0 ? <p className="mt-3 text-sm text-white/45">No items yet.</p> : <div className="mt-2 space-y-3">{items.map((item) => (
          <div key={item.id} className="border-t border-white/8 pt-3 first:border-0">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.quantity}x {item.name}</p><p className="text-xs text-white/45">{item.contributor_name} - {money(groupOrderLineTotalKobo(item))}</p>{item.addons.length > 0 && <p className="break-words text-xs text-white/40">{groupOrderAddonLabel(item.addons)}</p>}{item.notes && <p className="mt-1 break-words text-xs text-white/55">Note: {item.notes}</p>}</div>{!item.available && <span className="text-xs text-red-300">Unavailable</span>}</div>
            {item.mine && editable && <div className="mt-2 flex flex-wrap items-center gap-2"><button onClick={() => changeQuantity(item, item.quantity - 1)} disabled={item.quantity <= 1 || busy === item.id} aria-label={`Decrease ${item.name}`} className="h-11 w-11 rounded-lg border border-white/10">-</button><span className="min-w-6 text-center text-sm">{item.quantity}</span><button onClick={() => changeQuantity(item, item.quantity + 1)} disabled={busy === item.id} aria-label={`Increase ${item.name}`} className="h-11 w-11 rounded-lg border border-white/10">+</button><button onClick={() => openPicker((data.menu ?? []).find((entry) => entry.id === item.menu_item_id) ?? { id: item.menu_item_id, name: item.name, price_kobo: item.current_price_kobo, category: '', addons: item.addons.map((addon) => ({ ...addon, is_required: false })) }, item)} className="min-h-11 rounded-lg border border-white/10 px-3 text-xs">Edit options and note</button><button onClick={() => removeItem(item.id)} className="min-h-11 px-2 text-xs text-red-300">Remove</button></div>}
          </div>
        ))}<div className="flex justify-between border-t border-white/10 pt-3 text-sm font-semibold"><span>Food total</span><span>{money(total)}</span></div></div>}
      </section>

      {editable && data.participant_status !== 'READY' && <section className="mt-5"><h2 className="mb-2 text-xs uppercase text-white/45">Add from menu</h2><div className="space-y-2">{(data.menu ?? []).map((menu) => <button key={menu.id} onClick={() => openPicker(menu)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-left"><span className="min-w-0"><span className="block break-words text-sm">{menu.name}</span><span className="text-xs text-white/45">{money(menu.price_kobo)}</span></span><span className="shrink-0 text-sm text-amber-300">Add</span></button>)}</div></section>}

      {data.reconciliation.length > 0 && <section className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4"><h2 className="text-sm font-semibold text-amber-200">Review changes before checkout</h2><ul className="mt-2 space-y-1 text-xs text-white/65">{data.reconciliation.map((issue, index) => <li key={`${issue.type}-${index}`}>{issue.message}</li>)}</ul></section>}

      <div className="h-44 sm:h-32" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0A0A0B]/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)] [&>button]:w-full [&>button]:whitespace-normal [&>button]:px-3 [&>button]:py-3">
          {!data.is_host && editable && <button onClick={() => setReady(data.participant_status !== 'READY')} disabled={busy === 'ready' || (data.participant_status !== 'READY' && myItems.length === 0)} className="lx-btn-amber min-h-13 flex-1 disabled:opacity-50">{data.participant_status === 'READY' ? 'Continue editing' : 'Mark contribution ready'}</button>}
          {data.is_host && data.status === 'OPEN' && data.participant_status !== 'READY' && <><button onClick={cancelGroup} disabled={busy !== ''} className="min-h-13 rounded-xl border border-red-400/30 px-3 text-sm text-red-300">Cancel</button><button onClick={() => setReady(true)} disabled={busy !== '' || myItems.length === 0} className="lx-btn-amber min-h-13 flex-1 disabled:opacity-50">Mark my contribution ready</button></>}
          {data.is_host && data.status === 'OPEN' && data.participant_status === 'READY' && <><button onClick={() => setReady(false)} disabled={busy !== ''} className="min-h-13 rounded-xl border border-white/10 px-3 text-sm">Edit mine</button><button onClick={() => lockGroup('lock')} disabled={busy !== '' || items.length === 0} className="lx-btn-amber min-h-13 flex-1 disabled:opacity-50"><Lock className="mr-2 inline h-4 w-4" />Lock and reconcile</button></>}
          {data.is_host && data.status === 'LOCKED' && <><button onClick={() => lockGroup('unlock')} disabled={busy !== ''} className="min-h-13 rounded-xl border border-white/10 px-3 text-sm">Unlock</button><button onClick={continueToCheckout} disabled={busy !== '' || data.reconciliation.length > 0} className="lx-btn-amber min-h-13 flex-1 disabled:opacity-50"><ShoppingCart className="mr-2 inline h-4 w-4" />Organizer checkout</button></>}
          {data.is_host && data.status === 'AWAITING_PAYMENT' && <><button onClick={() => lockGroup('unlock')} disabled={busy !== ''} className="min-h-13 rounded-xl border border-white/10 px-3 text-sm">Reopen</button><button onClick={continueToCheckout} disabled={busy !== ''} className="lx-btn-amber min-h-13 flex-1"><ShoppingCart className="mr-2 inline h-4 w-4" />Return to payment</button></>}
          {!editable && !data.is_host && <p className="flex min-h-13 flex-1 items-center justify-center text-sm text-white/60">Group is {data.status.toLowerCase()}.</p>}
        </div>
      </div>
    </Shell>
  )
}

function GroupHeader({ data, remaining, onShare, onCopy, onWhatsApp }: { data: GroupData; remaining: string; onShare: () => void; onCopy: () => void; onWhatsApp: () => void }) {
  return <header><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase text-amber-300">{data.vendor.name}</p><h1 className="mt-1 break-words text-2xl font-bold">{data.name}</h1><p className="mt-1 text-sm text-white/50">Organized by {data.organizer.name}</p></div><button onClick={onShare} aria-label="Share group" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10"><Share2 className="h-4 w-4" /></button></div><div className="mt-4 flex flex-wrap gap-2"><span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs"><Clock className="h-3.5 w-3.5" />{remaining}</span><span className="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-3 text-xs">{data.status.toLowerCase()}</span><button onClick={onCopy} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs"><Copy className="h-3.5 w-3.5" />Copy link</button><button onClick={onWhatsApp} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-green-400/25 px-3 text-xs text-green-300"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</button></div></header>
}

function ProductPicker({ picker, selected, note, required, optional, complete, busy, onToggle, onNote, onClose, onSave }: { picker: { menu: MenuItem; editing?: GroupItem }; selected: string[]; note: string; required: MenuAddon[]; optional: MenuAddon[]; complete: boolean; busy: boolean; onToggle: (addon: MenuAddon) => void; onNote: (value: string) => void; onClose: () => void; onSave: () => void }) {
  const chosenTotal = picker.menu.price_kobo + picker.menu.addons.filter((addon) => selected.includes(addon.id)).reduce((sum, addon) => sum + addon.price_kobo, 0)
  const choices = (title: string, list: MenuAddon[], radio: boolean) => list.length > 0 && <section><div className="mb-2 flex items-center justify-between"><h3 className="text-xs uppercase text-white/55">{title}</h3>{radio && <span className="text-xs text-amber-300">Choose 1</span>}</div><div className="space-y-2">{list.map((addon) => { const active = selected.includes(addon.id); return <button key={addon.id} type="button" role={radio ? 'radio' : undefined} aria-checked={radio ? active : undefined} aria-pressed={radio ? undefined : active} onClick={() => onToggle(addon)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left" style={{ borderColor: active ? '#F5A623' : 'rgba(255,255,255,.1)' }}><span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${radio ? 'rounded-full' : 'rounded-md'}`} style={{ borderColor: active ? '#F5A623' : 'rgba(255,255,255,.3)', background: active ? '#F5A623' : 'transparent' }}>{active && <Check className="h-3 w-3 text-black" />}</span><span className="min-w-0 flex-1 break-words text-sm">{addon.name}</span><span className="shrink-0 text-xs text-white/50">{addon.price_kobo ? `+${money(addon.price_kobo)}` : 'Included'}</span></button> })}</div></section>
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}><div className="flex max-h-[95dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#111113]" onClick={(event) => event.stopPropagation()}><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{picker.menu.name}</h2><p className="text-sm text-amber-300">{money(picker.menu.price_kobo)}</p></div><button onClick={onClose} aria-label="Close product options" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10"><X className="h-4 w-4" /></button></div><div className="mt-5 space-y-5">{choices('Required choice', required, true)}{choices('Optional extras', optional, false)}<div><label htmlFor="group-item-note" className="mb-2 block text-xs uppercase text-white/55">Item note</label><textarea id="group-item-note" value={note} onChange={(event) => onNote(event.target.value.slice(0, 200))} rows={3} className="lx-field w-full resize-none px-3 py-2" placeholder="Optional note for the vendor" /></div></div></div><div className="shrink-0 border-t border-white/10 bg-[#111113] px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3"><button onClick={onSave} disabled={!complete || busy} className="lx-btn-amber min-h-13 w-full whitespace-normal px-3 py-3 disabled:opacity-50">{complete ? `${picker.editing ? 'Save changes' : 'Add to group'} - ${money(chosenTotal)}` : 'Choose 1 required option'}</button></div></div></div>
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p className="text-xs text-white/40">{label}</p><p className="mt-1 break-words text-sm">{value}</p></div> }
function Notice({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'error' }) { return <p className={`rounded-xl border p-3 text-sm ${tone === 'error' ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/[0.04] text-white/65'}`}>{children}</p> }
function Loading() { return <div className="space-y-3" aria-busy="true"><div className="lx-skeleton h-8 w-2/3 rounded-lg" /><div className="lx-skeleton h-20 rounded-xl" /><div className="lx-skeleton h-40 rounded-xl" /></div> }
function Shell({ children }: { children: React.ReactNode }) { return <main className="lx-page min-h-dvh px-4 py-6 sm:px-5 sm:py-10"><div className="mx-auto max-w-md">{children}</div></main> }
function remainingLabel(expiresAt: string, now: number) { const minutes = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 60000)); return minutes <= 0 ? 'Closed' : minutes < 60 ? `${minutes} min left` : `${Math.floor(minutes / 60)}h ${minutes % 60}m left` }
