import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { vendorPickupSettingsInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'

// Save a vendor's pickup (order ahead) preferences: whether they offer pickup at
// all, and a pacing cap on simultaneous pickup orders. Same auth + BOLA pattern
// as the hours route.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`vendor-pickup:${session.userId ?? session.phone}`, 30, 300)
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

  const parsed = vendorPickupSettingsInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid pickup settings' }, { status: 400 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.pickup_enabled !== undefined) update.pickup_enabled = parsed.data.pickup_enabled
  if (parsed.data.pickup_max_concurrent !== undefined) update.pickup_max_concurrent = parsed.data.pickup_max_concurrent

  await db.from('vendors').update(update).eq('id', id)

  return NextResponse.json({ success: true, ...parsed.data })
}
