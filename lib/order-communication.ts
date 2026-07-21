import 'server-only'

import type { SessionPayload } from '@/lib/session'
import { sanitize } from '@/lib/security'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export type OrderConversationChannel = 'CUSTOMER_RIDER' | 'VENDOR_RIDER'
export type OrderParticipantType = 'CUSTOMER' | 'VENDOR' | 'RIDER'

export interface CommunicationOrder {
  id: string
  customer_id: string | null
  vendor_id: string
  rider_id: string | null
  status: string
  delivered_at: string | null
  cancelled_at: string | null
}

export interface CommunicationActor {
  id: string
  type: OrderParticipantType
}

export type CommunicationAuthorization =
  | { ok: true; actor: CommunicationActor }
  | { ok: false; status: 403; error: string }

export function authorizeOrderConversation(
  session: SessionPayload,
  order: CommunicationOrder,
  channel: OrderConversationChannel,
): CommunicationAuthorization {
  if (!session.userId || !order.rider_id) {
    return { ok: false, status: 403, error: 'Messaging is unavailable for this order' }
  }

  if (
    session.role === 'customer'
    && channel === 'CUSTOMER_RIDER'
    && session.userId === order.customer_id
  ) return { ok: true, actor: { id: session.userId, type: 'CUSTOMER' } }

  if (
    session.role === 'vendor'
    && channel === 'VENDOR_RIDER'
    && session.userId === order.vendor_id
  ) return { ok: true, actor: { id: session.userId, type: 'VENDOR' } }

  if (session.role === 'rider' && session.userId === order.rider_id) {
    return { ok: true, actor: { id: session.userId, type: 'RIDER' } }
  }

  return { ok: false, status: 403, error: 'Forbidden' }
}

const TERMINAL_STATUSES = new Set([
  'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'NO_SHOW',
])

export function conversationWriteDeadline(
  order: CommunicationOrder,
  graceMinutes: number,
): Date | null {
  if (!TERMINAL_STATUSES.has(order.status)) return null
  const terminalAt = order.cancelled_at ?? order.delivered_at
  if (!terminalAt) return new Date(0) // terminal without a trustworthy clock: fail closed
  const timestamp = new Date(terminalAt).getTime()
  if (!Number.isFinite(timestamp)) return new Date(0)
  return new Date(timestamp + Math.max(0, graceMinutes) * 60_000)
}

export function isConversationWritable(
  order: CommunicationOrder,
  graceMinutes: number,
  now = new Date(),
): boolean {
  const deadline = conversationWriteDeadline(order, graceMinutes)
  return deadline === null || now.getTime() <= deadline.getTime()
}

export function sanitizeOrderMessage(input: string): string {
  return sanitize(input)
    .replace(/\bwww\.[^\s]+/gi, '[link removed]')
    .replace(/\b[a-z0-9][a-z0-9.-]*\.(?:com|ng|org|net|io|co)\b(?:\/[^\s]*)?/gi, '[link removed]')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type Db = ReturnType<typeof createSupabaseAdmin>

export async function getChatGraceMinutes(db: Db): Promise<number> {
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('id', 'order_chat_grace_period')
    .maybeSingle()
  const minutes = Number((data as { value?: { minutes?: number } } | null)?.value?.minutes)
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440 ? minutes : 60
}

export async function ensureActiveConversation(
  db: Db,
  orderId: string,
  channel: OrderConversationChannel,
  actor: CommunicationActor,
): Promise<{ id: string; is_active: boolean } | null> {
  const { data, error } = await db.rpc('order_chat_ensure_authorized', {
    p_order_id: orderId,
    p_channel: channel,
    p_actor_type: actor.type,
    p_actor_id: actor.id,
  })
  if (error || typeof data !== 'string') return null
  return { id: data, is_active: true }
}
