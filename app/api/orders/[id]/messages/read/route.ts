import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { orderMessageReadInput } from '@/lib/validators'
import {
  authorizeOrderConversation,
  type CommunicationOrder,
} from '@/lib/order-communication'

const idSchema = z.string().uuid()

export async function PATCH(
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
  const parsed = orderMessageReadInput.safeParse(input)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data } = await db.from('orders')
    .select('id, customer_id, vendor_id, rider_id, status, delivered_at, cancelled_at')
    .eq('id', id)
    .maybeSingle()
  const order = data as CommunicationOrder | null
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  const authorization = authorizeOrderConversation(session, order, parsed.data.channel)
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status })
  }
  const result = await db.rpc('mark_order_chat_read_authorized', {
    p_order_id: order.id,
    p_channel: parsed.data.channel,
    p_actor_type: authorization.actor.type,
    p_actor_id: authorization.actor.id,
    p_message_id: parsed.data.message_id ?? null,
  })
  if (result.error?.message.includes('invalid_message')) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
  if (result.error) return NextResponse.json({ error: 'Could not mark messages read' }, { status: 500 })
  if (!result.data) return NextResponse.json({ error: 'Conversation not found' }, { status: 403 })
  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
