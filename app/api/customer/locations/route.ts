import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { customerLocationInput } from '@/lib/validators'
import { captureCustomerLocation } from '@/lib/location-intelligence'
import { rateLimitGeneric } from '@/lib/rate-limit'

const SELECT = 'id, customer_id, label, latitude, longitude, delivery_note, city_id, zone_id, is_active, created_at, updated_at'

async function customerId(): Promise<string | null> {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return null
  if (session.userId) return session.userId
  const db = createSupabaseAdmin()
  const { data } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function GET() {
  const cid = await customerId()
  if (!cid) return NextResponse.json({ locations: [] })

  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('customer_locations')
    .select(SELECT)
    .eq('customer_id', cid)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ locations: [] })
  return NextResponse.json({ locations: data ?? [] })
}

export async function POST(req: NextRequest) {
  const cid = await customerId()
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`customer-locations:${cid}`, 24, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many changes. Please slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = customerLocationInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  const db = createSupabaseAdmin()
  const location = await captureCustomerLocation(db, {
    customerId: cid,
    label: parsed.data.label ?? null,
    deliveryNote: parsed.data.delivery_note ?? null,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    cityId: parsed.data.city_id ?? null,
    zoneId: parsed.data.zone_id ?? null,
  })

  if (!location) {
    return NextResponse.json({ error: 'Could not save location' }, { status: 500 })
  }

  const { data } = await db
    .from('customer_locations')
    .select(SELECT)
    .eq('id', location.id)
    .single()

  return NextResponse.json({ location: data })
}
