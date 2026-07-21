export type AdminOrderSearchKind = 'empty' | 'order' | 'phone' | 'uuid' | 'text'

export interface AdminOrderSearch {
  raw: string
  normalized: string
  kind: AdminOrderSearchKind
  digits: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORDER_RE = /^(?:LXF[-\s]?)?\d{4}[-\s]?\d{1,8}$/i

export function parseAdminOrderSearch(input: string | null | undefined): AdminOrderSearch {
  const raw = (input ?? '').trim()
  const normalized = raw.replace(/\s+/g, ' ')
  const digits = normalized.replace(/\D/g, '')
  if (!normalized) return { raw, normalized, kind: 'empty', digits }
  if (UUID_RE.test(normalized)) return { raw, normalized, kind: 'uuid', digits }
  if (ORDER_RE.test(normalized) || /^LXF/i.test(normalized)) return { raw, normalized: normalized.toUpperCase().replace(/\s+/g, '-'), kind: 'order', digits }
  if (digits.length >= 7 && digits.length >= Math.ceil(normalized.length * 0.55)) {
    return { raw, normalized, kind: 'phone', digits }
  }
  return { raw, normalized, kind: 'text', digits }
}

export function escapeSupabaseLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export function sanitizeUuidList(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id && UUID_RE.test(id))))
}

export interface AdminTimelineEvent {
  at: string
  type: 'order' | 'payment' | 'rider' | 'dispute' | 'refund' | 'audit' | 'wallet' | 'webhook'
  label: string
  detail?: Record<string, unknown>
}

type OrderTimelineSource = {
  id: string
  status?: string | null
  payment_status?: string | null
  rider_payment_status?: string | null
  created_at?: string | null
  placed_at?: string | null
  pending_since?: string | null
  vendor_accepted_at?: string | null
  preparing_at?: string | null
  ready_at?: string | null
  rider_assigned_at?: string | null
  picked_up_at?: string | null
  delivered_at?: string | null
  completed_at?: string | null
  cancelled_at?: string | null
  updated_at?: string | null
}

function pushEvent(events: AdminTimelineEvent[], at: unknown, type: AdminTimelineEvent['type'], label: string, detail?: Record<string, unknown>) {
  if (typeof at !== 'string' || !at) return
  events.push({ at, type, label, detail })
}

export function buildOrderTimeline(input: {
  order: OrderTimelineSource
  audits?: Array<Record<string, unknown>>
  disputes?: Array<Record<string, unknown>>
  refunds?: Array<Record<string, unknown>>
  walletTransactions?: Array<Record<string, unknown>>
  customerWalletTransactions?: Array<Record<string, unknown>>
  webhooks?: Array<Record<string, unknown>>
}): AdminTimelineEvent[] {
  const { order } = input
  const events: AdminTimelineEvent[] = []

  pushEvent(events, order.created_at, 'order', 'Order created')
  pushEvent(events, order.placed_at, 'order', 'Order placed')
  pushEvent(events, order.pending_since, 'payment', 'Payment pending')
  pushEvent(events, order.vendor_accepted_at, 'order', 'Vendor accepted')
  pushEvent(events, order.preparing_at, 'order', 'Preparation started')
  pushEvent(events, order.ready_at, 'order', 'Order ready')
  pushEvent(events, order.rider_assigned_at, 'rider', 'Rider assigned')
  pushEvent(events, order.picked_up_at, 'rider', 'Picked up')
  pushEvent(events, order.delivered_at, 'order', 'Delivered')
  pushEvent(events, order.completed_at, 'order', 'Completed')
  pushEvent(events, order.cancelled_at, 'order', 'Cancelled')
  pushEvent(events, order.updated_at, 'order', 'Last order update', {
    status: order.status,
    payment_status: order.payment_status,
    rider_payment_status: order.rider_payment_status,
  })

  for (const row of input.disputes ?? []) {
    pushEvent(events, row.created_at, 'dispute', `Dispute ${String(row.status ?? 'opened')}`, { reason: row.reason, dispute_id: row.id })
    pushEvent(events, row.resolved_at, 'dispute', 'Dispute resolved', { dispute_id: row.id, resolved_by: row.resolved_by })
  }
  for (const row of input.refunds ?? []) {
    pushEvent(events, row.created_at, 'refund', `Refund ${String(row.status ?? 'created')}`, {
      refund_id: row.id,
      amount_kobo: row.amount_kobo,
      reference: row.paystack_refund_reference ?? row.paystack_transaction_reference,
    })
  }
  for (const row of input.walletTransactions ?? []) {
    pushEvent(events, row.created_at, 'wallet', `Wallet ${String(row.type ?? 'transaction')}`, {
      id: row.id,
      amount: row.amount,
      status: row.status,
      user_type: row.user_type,
      reference: row.reference,
    })
  }
  for (const row of input.customerWalletTransactions ?? []) {
    pushEvent(events, row.created_at, 'wallet', `Customer wallet ${String(row.type ?? 'transaction')}`, {
      id: row.id,
      amount_kobo: row.amount_kobo,
      reference: row.reference,
    })
  }
  for (const row of input.webhooks ?? []) {
    pushEvent(events, row.created_at, 'webhook', `Webhook ${String(row.event ?? 'received')}`, {
      id: row.id,
      reference: row.reference ?? row.paystack_reference,
    })
  }
  for (const row of input.audits ?? []) {
    pushEvent(events, row.created_at, 'audit', String(row.action ?? 'Admin action'), {
      id: row.id,
      actor_id: row.actor_id,
      actor_role: row.actor_role,
      old_value: row.old_value,
      new_value: row.new_value,
    })
  }

  return events
    .filter((event, index, all) => all.findIndex((candidate) => candidate.at === event.at && candidate.type === event.type && candidate.label === event.label) === index)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
