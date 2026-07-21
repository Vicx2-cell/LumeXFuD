import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { orderMessageChannel, orderMessageInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import {
  authorizeOrderConversation,
  sanitizeOrderMessage,
  type CommunicationOrder,
} from '@/lib/order-communication'

const idSchema = z.string().uuid()
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

async function loadOrder(id: string) {
  const db = createSupabaseAdmin()
  const result = await db.from('orders')
    .select('id, customer_id, vendor_id, rider_id, status, delivered_at, cancelled_at')
    .eq('id', id)
    .maybeSingle()
  return { db, order: result.data as CommunicationOrder | null }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  const parsedChannel = orderMessageChannel.safeParse(req.nextUrl.searchParams.get('channel'))
  if (!parsedChannel.success) {
    return NextResponse.json({ error: 'Invalid conversation channel' }, { status: 400 })
  }

  const { db, order } = await loadOrder(id)
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  const authorization = authorizeOrderConversation(session, order, parsedChannel.data)
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status })
  }
  const after = req.nextUrl.searchParams.get('after')
  const before = req.nextUrl.searchParams.get('before')
  if (after && before) {
    return NextResponse.json({ error: 'Use only one message cursor' }, { status: 400 })
  }
  const parsedAfter = after ? new Date(after) : null
  const parsedBefore = before ? new Date(before) : null
  if ((parsedAfter && !Number.isFinite(parsedAfter.getTime())) || (parsedBefore && !Number.isFinite(parsedBefore.getTime()))) {
    return NextResponse.json({ error: 'Invalid message cursor' }, { status: 400 })
  }
  const { data, error } = await db.rpc('get_order_chat_page_authorized', {
    p_order_id: order.id,
    p_channel: parsedChannel.data,
    p_actor_type: authorization.actor.type,
    p_actor_id: authorization.actor.id,
    p_before: parsedBefore?.toISOString() ?? null,
    p_after: parsedAfter?.toISOString() ?? null,
    p_limit: 100,
  })
  if (error) return NextResponse.json({ error: 'Could not load messages' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Messaging is unavailable for this order' }, { status: 403 })
  return NextResponse.json(data, { headers: noStore })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  let input: unknown
  try { input = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = orderMessageInput.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid message', details: parsed.error.flatten() }, { status: 400 })
  }

  const { db, order } = await loadOrder(id)
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  const authorization = authorizeOrderConversation(session, order, parsed.data.channel)
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status })
  }
  const limit = await rateLimitGeneric(
    `order-message:${id}:${authorization.actor.type}:${authorization.actor.id}`,
    12,
    60,
  )
  if (!limit.success) {
    return NextResponse.json({ error: 'Too many messages. Please wait a moment.' }, { status: 429 })
  }

  const clean = sanitizeOrderMessage(parsed.data.message)
  if (!clean) return NextResponse.json({ error: 'Message is empty after safety filtering' }, { status: 400 })
  const result = await db.rpc('send_order_chat_message_authorized', {
    p_order_id: order.id,
    p_channel: parsed.data.channel,
    p_actor_type: authorization.actor.type,
    p_actor_id: authorization.actor.id,
    p_body: clean,
    p_client_message_id: parsed.data.client_message_id,
  })
  if (result.error?.message.includes('chat_read_only')) {
    return NextResponse.json({ error: 'This conversation is now read-only' }, { status: 409 })
  }
  if (result.error?.message.includes('chat_rate_limited')) {
    return NextResponse.json({ error: 'Too many messages. Please wait a moment.' }, { status: 429 })
  }
  if (result.error || !result.data) return NextResponse.json({ error: 'Could not send message' }, { status: 500 })
  const payload = result.data as { message: unknown; replayed: boolean }
  return NextResponse.json(payload, { status: payload.replayed ? 200 : 201, headers: noStore })
}
