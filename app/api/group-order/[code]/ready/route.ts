import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { resolveGroupParticipant } from '@/lib/group-order-participant'

const input = z.object({ ready: z.boolean() }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (session && session.role !== 'customer') return NextResponse.json({ error: 'Customer participants only.' }, { status: 403 })
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid readiness state.' }, { status: 400 })

  const { code: rawCode } = await params
  const code = rawCode.toUpperCase()
  const db = createSupabaseAdmin()
  const { data: groupRow } = await db.from('group_orders').select('id').eq('code', code).maybeSingle()
  const groupId = (groupRow as { id?: string } | null)?.id
  if (!groupId) return NextResponse.json({ error: 'Group order not found.' }, { status: 404 })
  const actor = await resolveGroupParticipant(db, groupId, code, session)
  if (!actor.participantId) return NextResponse.json({ error: 'Join this group first.' }, { status: 401 })

  const { data: result, error } = await db.rpc('group_order_set_ready', {
    p_group_id: groupId,
    p_participant_id: actor.participantId,
    p_ready: parsed.data.ready,
  })
  if (error) return NextResponse.json({ error: 'Could not update readiness.' }, { status: 500 })
  if (result !== 'ok') {
    const message = result === 'empty' ? 'Add at least one item before marking ready.' : 'The group was locked while you were editing.'
    return NextResponse.json({ error: message, conflict: result === 'locked' }, { status: 409 })
  }
  return NextResponse.json({ success: true, status: parsed.data.ready ? 'READY' : 'EDITING' })
}
