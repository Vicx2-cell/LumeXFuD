'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart, cartLineKey, type CartItem } from '@/components/cart-context'

interface ReorderResponse {
  vendor_id: string
  vendor_name: string
  items: Array<{ id: string; name: string; price_kobo: number; quantity: number; special_instructions?: string }>
  skipped_items: string[]
  error?: string
  vendor_closed?: boolean
}

// "Order again" — rebuilds the cart from a past order and sends the customer to
// checkout. Lives inside the order card's <Link>, so it must stop the click from
// also navigating to the order page.
export function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter()
  const { replaceCart } = useCart()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function reorder(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`/api/orders/${orderId}/reorder`, { method: 'POST' })
      const data = (await res.json()) as ReorderResponse
      if (!res.ok || data.vendor_closed) {
        setMsg(data.error ?? 'Could not reorder right now')
        setBusy(false)
        return
      }
      if (!data.items || data.items.length === 0) {
        setMsg('Those items aren’t available anymore')
        setBusy(false)
        return
      }

      const items: CartItem[] = data.items.map((it) => ({
        id: cartLineKey(it.id, []),
        menu_item_id: it.id,
        name: it.name,
        price_kobo: it.price_kobo,
        quantity: Math.min(Math.max(it.quantity, 1), 20),
        special_instructions: it.special_instructions,
        addons: [],
      }))

      replaceCart({ vendor_id: data.vendor_id, vendor_name: data.vendor_name, items })

      // Let the customer know if some items dropped off the menu since.
      if (data.skipped_items?.length) {
        try { sessionStorage.setItem('reorder_skipped', data.skipped_items.join(', ')) } catch { /* ignore */ }
      }
      router.push('/cart')
    } catch {
      setMsg('Network error — try again')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={reorder}
      disabled={busy}
      className="inline-flex items-center text-xs font-medium py-1.5 -my-1.5 transition-opacity active:opacity-60 disabled:opacity-50"
      style={{ color: '#F5A623', minHeight: 44 }}
    >
      {busy ? 'Adding to cart…' : msg ? msg : '🔁 Order again'}
    </button>
  )
}
