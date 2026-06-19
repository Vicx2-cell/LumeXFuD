import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { businessHoursInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'

// Save the rider's normal working hours (display only — does not gate orders).
// Same auth + BOLA pattern as the rider status route.
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

  const rl = await rateLimitGeneric(`rider-hours:${session.userId ?? session.phone}`, 30, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  if (session.role === 'rider' && rider.id !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = businessHoursInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid start and end time' }, { status: 400 })

  await db.from('riders').update({
    opening_time: parsed.data.opening_time,
    closing_time: parsed.data.closing_time,
  }).eq('id', id)

  return NextResponse.json({
    success: true,
    opening_time: parsed.data.opening_time,
    closing_time: parsed.data.closing_time,
  })
}
