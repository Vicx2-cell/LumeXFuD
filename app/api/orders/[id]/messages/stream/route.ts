import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getCurrentUser, isSessionLive } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { orderMessageChannel } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import {
  authorizeOrderConversation,
  conversationWriteDeadline,
  ensureActiveConversation,
  getChatGraceMinutes,
  isConversationWritable,
  type CommunicationOrder,
} from '@/lib/order-communication'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const idSchema = z.string().uuid()
const encoder = new TextEncoder()

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser()
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  if (!idSchema.safeParse(id).success) return jsonError('Order not found', 404)
  const channelResult = orderMessageChannel.safeParse(req.nextUrl.searchParams.get('channel'))
  if (!channelResult.success) return jsonError('Invalid conversation channel', 400)

  const db = createSupabaseAdmin()
  const loadOrder = async () => {
    const { data } = await db.from('orders')
      .select('id, customer_id, vendor_id, rider_id, status, delivered_at, cancelled_at')
      .eq('id', id)
      .maybeSingle()
    return data as CommunicationOrder | null
  }
  const order = await loadOrder()
  if (!order) return jsonError('Order not found', 404)
  const authorization = authorizeOrderConversation(session, order, channelResult.data)
  if (!authorization.ok) return jsonError(authorization.error, authorization.status)
  const conversation = await ensureActiveConversation(db, order.id, channelResult.data, authorization.actor)
  if (!conversation) return jsonError('Messaging is unavailable for this order', 409)

  const limit = await rateLimitGeneric(
    `order-message-stream:${id}:${authorization.actor.type}:${authorization.actor.id}`,
    10,
    60,
  )
  if (!limit.success) return jsonError('Too many reconnects. Please wait a moment.', 429)

  let stopped = false
  let cleanup: (() => Promise<void>) | null = null
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, value: unknown) => {
        if (stopped) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`))
        } catch { stopped = true }
      }
      const close = () => {
        if (stopped) return
        stopped = true
        try { controller.close() } catch { /* already closed */ }
      }
      const verifyAccess = async () => {
        if (!(await isSessionLive(session.sessionId))) return false
        const latestOrder = await loadOrder()
        if (!latestOrder) return false
        return authorizeOrderConversation(session, latestOrder, channelResult.data).ok
      }

      const graceMinutes = await getChatGraceMinutes(db)
      send('state', {
        writable: isConversationWritable(order, graceMinutes),
        closes_at: conversationWriteDeadline(order, graceMinutes)?.toISOString() ?? null,
      })

      const realtime = db.channel(`order-communication:${conversation.id}:${crypto.randomUUID()}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'order_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        }, (payload) => {
          const row = payload.new as Record<string, unknown>
          send('message', {
            id: row.id,
            sender_id: row.sender_id,
            sender_type: row.sender_type,
            message_type: row.message_type,
            body: row.body,
            metadata: row.metadata,
            created_at: row.created_at,
          })
        })
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'order_message_reads',
          filter: `conversation_id=eq.${conversation.id}`,
        }, (payload) => {
          const row = payload.new as Record<string, unknown>
          send('receipt', {
            participant_type: row.participant_type,
            participant_id: row.participant_id,
            last_read_at: row.last_read_at,
            last_read_message_id: row.last_read_message_id,
          })
        })
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'order_conversations',
          filter: `id=eq.${conversation.id}`,
        }, (payload) => {
          const row = payload.new as Record<string, unknown>
          if (row.is_active === false) {
            send('access_revoked', { reason: 'rider_reassigned' })
            close()
          }
        })
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'orders',
          filter: `id=eq.${id}`,
        }, () => { void verifyAccess().then((allowed) => {
          if (!allowed) {
            send('access_revoked', { reason: 'order_access_changed' })
            close()
          }
        }) })
        .subscribe()

      const heartbeat = setInterval(() => {
        void verifyAccess().then((allowed) => {
          if (!allowed) {
            send('access_revoked', { reason: 'access_changed' })
            close()
            return
          }
          send('ping', { at: new Date().toISOString() })
        }).catch(() => {
          send('access_revoked', { reason: 'authorization_unavailable' })
          close()
        })
      }, 5_000)
      const lifetime = setTimeout(close, 25_000)
      const abort = () => close()
      req.signal.addEventListener('abort', abort, { once: true })

      cleanup = async () => {
        clearInterval(heartbeat)
        clearTimeout(lifetime)
        req.signal.removeEventListener('abort', abort)
        await db.removeChannel(realtime)
      }

      while (!stopped) await new Promise((resolve) => setTimeout(resolve, 250))
      await cleanup()
      cleanup = null
    },
    async cancel() {
      stopped = true
      if (cleanup) await cleanup()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
