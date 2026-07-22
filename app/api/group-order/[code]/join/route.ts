import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import {
  createGroupParticipantToken,
  groupParticipantCookieName,
  groupParticipantCookieOptions,
  hashGroupParticipantToken,
} from '@/lib/group-participant-session'

const joinInput = z.object({ display_name: z.string().trim().min(2).max(60) }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (session && session.role !== 'customer') return NextResponse.json({ error: 'Customer participants only.' }, { status: 403 })

  const body = joinInput.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Enter your name to join.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const rl = await rateLimitGeneric(`group-join:${session?.phone ?? ip}`, 20, 600)
  if (!rl.success) return NextResponse.json({ error: 'Too many join attempts.' }, { status: 429 })

  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const db = createSupabaseAdmin()
  const { data: groupRow } = await db.from('group_orders')
    .select('id, status, expires_at, participant_limit')
    .eq('code', code)
    .maybeSingle()
  const group = groupRow as { id: string; status: string; expires_at: string; participant_limit: number } | null
  if (!group) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  if (group.status !== 'OPEN' || Date.parse(group.expires_at) <= Date.now()) {
    return NextResponse.json({ error: 'This group is closed.' }, { status: 409 })
  }

  let customerId: string | null = null
  if (session) {
    const { data: customer } = await db.from('customers').select('id').eq('phone', session.phone).is('deleted_at', null).maybeSingle()
    customerId = (customer as { id?: string } | null)?.id ?? null
    if (!customerId) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
    const { data: existing } = await db.from('group_order_participants')
      .select('id, status').eq('group_order_id', group.id).eq('customer_id', customerId).maybeSingle()
    if (existing) {
      const row = existing as { id: string; status: string }
      if (row.status === 'REMOVED' || row.status === 'EXPIRED') return NextResponse.json({ error: 'This participant session is closed.' }, { status: 410 })
      return NextResponse.json({ participant_id: row.id, status: row.status, resumed: true })
    }
  } else {
    const cookieStore = await cookies()
    const existingToken = cookieStore.get(groupParticipantCookieName(code))?.value
    if (existingToken) {
      const { data: existing } = await db.from('group_order_participants')
        .select('id, status').eq('group_order_id', group.id).eq('guest_session_hash', hashGroupParticipantToken(existingToken)).maybeSingle()
      if (existing) {
        const row = existing as { id: string; status: string }
        if (row.status === 'REMOVED' || row.status === 'EXPIRED') return NextResponse.json({ error: 'This participant session is closed.' }, { status: 410 })
        return NextResponse.json({ participant_id: row.id, status: row.status, resumed: true })
      }
    }
  }

  const { count } = await db.from('group_order_participants')
    .select('id', { count: 'exact', head: true })
    .eq('group_order_id', group.id)
    .in('status', ['JOINED', 'EDITING', 'READY'])
  if ((count ?? 0) >= group.participant_limit) {
    return NextResponse.json({ error: 'This group has reached its participant limit.', full: true }, { status: 409 })
  }

  const token = customerId ? null : createGroupParticipantToken()
  const { data: participant, error } = await db.from('group_order_participants').insert({
    group_order_id: group.id,
    customer_id: customerId,
    guest_session_hash: token ? hashGroupParticipantToken(token) : null,
    display_name: body.data.display_name,
    status: 'JOINED',
  }).select('id, status').single()
  if (error || !participant) return NextResponse.json({ error: 'Could not join this group.' }, { status: 500 })

  await db.from('group_order_events').insert({
    group_order_id: group.id,
    actor_participant_id: participant.id,
    actor_customer_id: customerId,
    event_type: 'participant_joined',
  })

  const response = NextResponse.json({ participant_id: participant.id, status: participant.status, resumed: false })
  if (token) response.cookies.set(groupParticipantCookieName(code), token, groupParticipantCookieOptions(group.expires_at))
  return response
}
