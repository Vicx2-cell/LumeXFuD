import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

const inspectionInput = z.object({
  rough_location_description: z.string().trim().min(2).max(200).optional(),
  official_latitude: z.number().min(-90).max(90),
  official_longitude: z.number().min(-180).max(180),
  storefront_photo_url: z.string().trim().url().max(500),
  notes: z.string().trim().max(1000).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`vendor-inspection:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = inspectionInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid inspection data' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, official_latitude, official_longitude, storefront_photo_url, approval_state, site_inspected')
    .eq('id', id)
    .single()
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  const updates = {
    rough_location_description: parsed.data.rough_location_description ?? undefined,
    official_latitude: parsed.data.official_latitude,
    official_longitude: parsed.data.official_longitude,
    storefront_photo_url: parsed.data.storefront_photo_url,
    site_inspected: true,
    approval_state: 'shop_inspected',
    updated_at: new Date().toISOString(),
  }

  const { error } = await db.from('vendors').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not save inspection data' }, { status: 500 })

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'vendor_inspection_completed',
    target_table: 'vendors',
    target_id: id,
    old_value: {
      official_latitude: vendor.official_latitude,
      official_longitude: vendor.official_longitude,
      storefront_photo_url: vendor.storefront_photo_url,
      site_inspected: vendor.site_inspected,
      approval_state: vendor.approval_state,
    },
    new_value: updates,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}

