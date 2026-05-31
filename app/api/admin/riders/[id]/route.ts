import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'

const updateInput = z.object({
  action: z.enum(['approve', 'suspend', 'unsuspend']),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = updateInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, is_active')
    .eq('id', id)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {}

  if (parsed.data.action === 'approve') {
    updates.is_active = true
    updates.approved_at = now
    updates.approved_by = session.phone
  } else if (parsed.data.action === 'suspend') {
    updates.is_active = false
    updates.status = 'OFFLINE'
  } else {
    updates.is_active = true
  }

  await db.from('riders').update(updates).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `rider_${parsed.data.action}`,
    target_table: 'riders',
    target_id: id,
    old_value: { is_active: rider.is_active },
    new_value: updates,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
