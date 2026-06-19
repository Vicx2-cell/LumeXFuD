import crypto from 'crypto'
import { createSupabaseAdmin } from './supabase/server'
import { sendWhatsAppWithFallback } from './notify'

// Shareable group-order code: 6 chars, unambiguous alphabet (no 0/O/1/I/L) so it
// reads cleanly over WhatsApp. ~30^6 ≈ 730M combos; the DB UNIQUE constraint is
// the real guard (callers retry on the rare collision).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateGroupCode(len = 6): string {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return s
}

interface ContribAgg { name: string; items: string[]; total: number }

/**
 * Notify every participant that the group order has been PLACED + where it's
 * going. Idempotent: only the caller that flips the group OPEN→CHECKED_OUT sends
 * (so the wallet path and a retried webhook never double-notify). Best-effort —
 * never throws, so it can't disturb the order/payment flow that calls it.
 */
export async function notifyGroupOrderPlaced(
  db: ReturnType<typeof createSupabaseAdmin>,
  opts: { groupOrderId: string; orderNumber: string; deliveryAddress: string; appUrl: string },
): Promise<void> {
  try {
    const { data: flipped } = await db
      .from('group_orders')
      .update({ status: 'CHECKED_OUT' })
      .eq('id', opts.groupOrderId)
      .eq('status', 'OPEN')
      .select('id, vendor_id, host_customer_id')
    if (!flipped || flipped.length === 0) return // already finalized → don't re-notify
    const group = flipped[0] as { id: string; vendor_id: string; host_customer_id: string }

    // Did the host choose to split, or treat everyone? Best-effort (default split).
    let splitEnabled = true
    try {
      const { data: s } = await db.from('group_orders').select('split_enabled').eq('id', opts.groupOrderId).maybeSingle()
      const v = (s as { split_enabled?: boolean } | null)?.split_enabled
      if (typeof v === 'boolean') splitEnabled = v
    } catch { /* column may not exist yet → default split */ }

    const [{ data: vendor }, { data: host }, { data: items }, { data: ord }] = await Promise.all([
      db.from('vendors').select('name').eq('id', group.vendor_id).maybeSingle(),
      db.from('customers').select('name').eq('id', group.host_customer_id).maybeSingle(),
      db.from('group_order_items').select('contributor_id, contributor_name, quantity, menu_items(name, price_kobo)').eq('group_order_id', opts.groupOrderId),
      db.from('orders').select('delivery_fee, platform_markup').eq('paystack_reference', opts.orderNumber).maybeSingle(),
    ])
    const vendorName = (vendor as { name: string | null } | null)?.name ?? 'the vendor'
    const hostName = ((host as { name: string | null } | null)?.name ?? 'your friend').split(/\s+/)[0]

    const byContributor = new Map<string, ContribAgg>()
    for (const r of items ?? []) {
      const row = r as unknown as { contributor_id: string; contributor_name: string | null; quantity: number; menu_items: { name: string; price_kobo: number } | null }
      const e = byContributor.get(row.contributor_id) ?? { name: row.contributor_name ?? 'Someone', items: [], total: 0 }
      e.items.push(`${row.quantity}× ${row.menu_items?.name ?? 'item'}`)
      e.total += (row.menu_items?.price_kobo ?? 0) * row.quantity
      byContributor.set(row.contributor_id, e)
    }
    const ids = Array.from(byContributor.keys())
    if (ids.length === 0) return

    // Split delivery + platform fee EQUALLY among everyone in the group.
    const order = ord as { delivery_fee: number | null; platform_markup: number | null } | null
    const feesKobo = (Number(order?.delivery_fee) || 0) + (Number(order?.platform_markup) || 0)
    const feeShare = Math.round(feesKobo / ids.length)
    const naira = (k: number) => `₦${Math.round(k / 100).toLocaleString()}`

    const { data: custs } = await db.from('customers').select('id, phone').in('id', ids)
    const phoneMap = new Map((custs ?? []).map((c) => [(c as { id: string }).id, (c as { phone: string }).phone]))
    const track = `${opts.appUrl}/order/${opts.orderNumber}`

    // Host's breakdown (only when splitting): each person's food + fee share.
    const splitLines = Array.from(byContributor.values())
      .map((p) => `• ${p.name}: ${naira(p.total + feeShare)}`)
      .join('\n')

    for (const [cid, info] of byContributor) {
      const phone = phoneMap.get(cid)
      if (!phone) continue
      const summary = info.items.join(', ')
      const isHost = cid === group.host_customer_id
      let msg: string
      if (!splitEnabled) {
        // Host is treating everyone — nobody owes anything.
        msg = isHost
          ? `✅ Your group order from ${vendorName} is placed — you're treating everyone 🎁\nDelivering to: ${opts.deliveryAddress}\nYour items: ${summary}\nTrack: ${track}`
          : `✅ ${hostName}'s group order from ${vendorName} is placed — ${hostName} is treating everyone 🎁\nDelivering to: ${opts.deliveryAddress}\nYour items: ${summary}\nNo need to pay anyone back!\nTrack: ${track}`
      } else {
        const owe = info.total + feeShare
        msg = isHost
          ? `✅ Your group order from ${vendorName} is placed!\nDelivering to: ${opts.deliveryAddress}\nYour items: ${summary}\nTrack: ${track}\n\nWho owes what (food + split fees):\n${splitLines}`
          : `✅ ${hostName}'s group order from ${vendorName} is placed — ${hostName} paid for everyone!\nDelivering to: ${opts.deliveryAddress}\nYour items: ${summary}\nYour share: ${naira(info.total)} food + ${naira(feeShare)} fees = ${naira(owe)} — settle up with ${hostName}.\nTrack: ${track}`
      }
      void sendWhatsAppWithFallback({ to: phone, message: msg }).catch(() => {})
    }
  } catch (err) {
    console.error('[group-order] notifyGroupOrderPlaced failed:', err)
  }
}

/** Tell the (non-host) participants the host cancelled the group. Best-effort. */
export async function notifyGroupCancelled(
  db: ReturnType<typeof createSupabaseAdmin>,
  groupOrderId: string,
): Promise<void> {
  try {
    const { data: gRow } = await db.from('group_orders').select('vendor_id, host_customer_id').eq('id', groupOrderId).maybeSingle()
    const g = gRow as { vendor_id: string; host_customer_id: string } | null
    if (!g) return
    const [{ data: vendor }, { data: host }, { data: items }] = await Promise.all([
      db.from('vendors').select('name').eq('id', g.vendor_id).maybeSingle(),
      db.from('customers').select('name').eq('id', g.host_customer_id).maybeSingle(),
      db.from('group_order_items').select('contributor_id').eq('group_order_id', groupOrderId),
    ])
    const vendorName = (vendor as { name: string | null } | null)?.name ?? 'the vendor'
    const hostName = ((host as { name: string | null } | null)?.name ?? 'The host').split(/\s+/)[0]
    const ids = Array.from(new Set((items ?? []).map((r) => (r as { contributor_id: string }).contributor_id)))
      .filter((id) => id !== g.host_customer_id)
    if (ids.length === 0) return
    const { data: custs } = await db.from('customers').select('id, phone').in('id', ids)
    for (const c of (custs ?? []) as Array<{ id: string; phone: string }>) {
      if (!c.phone) continue
      void sendWhatsAppWithFallback({
        to: c.phone,
        message: `❌ ${hostName} cancelled the group order from ${vendorName}. Nothing was charged.`,
      }).catch(() => {})
    }
  } catch (err) {
    console.error('[group-order] notifyGroupCancelled failed:', err)
  }
}
