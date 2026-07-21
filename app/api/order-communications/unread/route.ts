import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const participantType = {
  customer: 'CUSTOMER',
  vendor: 'VENDOR',
  rider: 'RIDER',
} as const

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(session.role in participantType) || !session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const type = participantType[session.role as keyof typeof participantType]
  const { data, error } = await createSupabaseAdmin().rpc('get_order_chat_unread', {
    p_participant_type: type,
    p_participant_id: session.userId,
  })
  if (error) return NextResponse.json({ error: 'Could not load unread messages' }, { status: 500 })
  const counts = ((data ?? []) as Array<{
    conversation_id: string
    order_id: string
    channel: string
    unread_count: number | string
  }>).map((row) => ({ ...row, unread_count: Number(row.unread_count) || 0 }))
  return NextResponse.json({ counts }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
