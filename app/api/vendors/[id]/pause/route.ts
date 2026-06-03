import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { vendorPauseInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`vendor-pause:${session.userId ?? session.phone}`, 30, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  if (session.role === 'vendor' && vendor.id !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = vendorPauseInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid pause duration' }, { status: 400 })

  const minutes = parseInt(parsed.data.minutes, 10)
  const pausedUntil = new Date(Date.now() + minutes * 60_000).toISOString()

  await db.from('vendors').update({
    status: 'BUSY',
    paused_until: pausedUntil,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ success: true, paused_until: pausedUntil })
}
