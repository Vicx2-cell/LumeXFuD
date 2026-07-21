import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const idSchema = z.string().uuid()

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })
  const db = createSupabaseAdmin()
  const { data: dispute } = await db.from('disputes')
    .select('id, order_id')
    .eq('order_id', id)
    .maybeSingle()
  if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })

  const { data: conversations, error } = await db.from('order_conversations')
    .select('id, channel, rider_id, assignment_version, is_active, created_at, closed_at, riders ( full_name )')
    .eq('order_id', id)
    .order('assignment_version', { ascending: true })
    .order('channel', { ascending: true })
  if (error) return NextResponse.json({ error: 'Could not load dispute transcript' }, { status: 500 })
  const conversationIds = (conversations ?? []).map((conversation) => conversation.id)
  const messages = conversationIds.length === 0
    ? []
    : (await db.from('order_messages')
        .select('id, conversation_id, sender_type, message_type, body, metadata, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: true })
        .limit(1000)).data ?? []

  return NextResponse.json({ conversations: conversations ?? [], messages }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
