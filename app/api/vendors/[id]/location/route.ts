import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { vendorLocationInput } from '@/lib/validators'
import { cleanVendorLocation } from '@/lib/vendor-location'
import { rateLimitGeneric } from '@/lib/rate-limit'

const SELECT = 'address_text, landmark, latitude, longitude, location_photo_url'

// Save a vendor's PUBLIC store location — an address line, a rider landmark cue,
// and an exact map pin — so customers and riders can find/navigate to the shop.
// Same auth + BOLA pattern as the pickup-settings route. The storefront photo is
// uploaded separately via /api/profile/image (slot=storefront).
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

  const rl = await rateLimitGeneric(`vendor-location:${session.userId ?? session.phone}`, 30, 300)
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

  const parsed = vendorLocationInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid location' }, { status: 400 })

  const clean = cleanVendorLocation(parsed.data)
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })

  const { data, error } = await db
    .from('vendors')
    .update({
      address_text: clean.value.address_text,
      landmark: clean.value.landmark,
      latitude: clean.value.latitude,
      longitude: clean.value.longitude,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(SELECT)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Could not save location' }, { status: 500 })

  return NextResponse.json({ success: true, location: data })
}
