import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { isBankVerified, BANK_GATE_MESSAGE } from '@/lib/wallet'

const riderStatusInput = z.object({ status: z.enum(['ONLINE', 'OFFLINE']) })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rider', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`rider-status:${session.userId ?? session.phone}`, 60, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, active_order_id')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  if (session.role === 'rider' && rider.id !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = riderStatusInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  // Cannot go offline while on an active order
  if (parsed.data.status === 'OFFLINE' && rider.active_order_id) {
    return NextResponse.json({ error: 'Complete your current delivery before going offline' }, { status: 400 })
  }

  // Mandatory verified bank before a rider can go ONLINE (admins/super-admins exempt).
  if (parsed.data.status === 'ONLINE' && session.role === 'rider' && !(await isBankVerified(id, 'RIDER'))) {
    return NextResponse.json({ error: BANK_GATE_MESSAGE, code: 'BANK_REQUIRED' }, { status: 403 })
  }

  await db.from('riders').update({
    status: parsed.data.status,
    last_status_update_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ success: true, status: parsed.data.status })
}
