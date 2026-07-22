import { cookies } from 'next/headers'
import type { createSupabaseAdmin } from '@/lib/supabase/server'
import { groupParticipantCookieName, hashGroupParticipantToken } from '@/lib/group-participant-session'

type Db = ReturnType<typeof createSupabaseAdmin>
type SessionLike = { role: string; phone: string } | null

export interface ResolvedGroupParticipant {
  participantId: string | null
  customerId: string | null
  displayName: string | null
  status: string | null
}

export async function resolveGroupParticipant(
  db: Db,
  groupId: string,
  code: string,
  session: SessionLike,
): Promise<ResolvedGroupParticipant> {
  if (session?.role === 'customer') {
    const { data: customer } = await db.from('customers').select('id, name').eq('phone', session.phone).is('deleted_at', null).maybeSingle()
    const row = customer as { id: string; name: string | null } | null
    if (!row) return { participantId: null, customerId: null, displayName: null, status: null }
    const { data: participant } = await db.from('group_order_participants')
      .select('id, display_name, status')
      .eq('group_order_id', groupId)
      .eq('customer_id', row.id)
      .maybeSingle()
    const p = participant as { id: string; display_name: string; status: string } | null
    return {
      participantId: p?.id ?? null,
      customerId: row.id,
      displayName: p?.display_name ?? row.name,
      status: p?.status ?? null,
    }
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(groupParticipantCookieName(code))?.value
  if (!token) return { participantId: null, customerId: null, displayName: null, status: null }
  const { data: participant } = await db.from('group_order_participants')
    .select('id, display_name, status')
    .eq('group_order_id', groupId)
    .eq('guest_session_hash', hashGroupParticipantToken(token))
    .maybeSingle()
  const p = participant as { id: string; display_name: string; status: string } | null
  return {
    participantId: p?.id ?? null,
    customerId: null,
    displayName: p?.display_name ?? null,
    status: p?.status ?? null,
  }
}
