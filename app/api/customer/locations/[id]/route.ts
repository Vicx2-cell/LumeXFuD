import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { updateCustomerLocationInput } from '@/lib/validators'
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cid = await customerId()
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`customer-locations:${cid}`, 24, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many changes. Please slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = updateCustomerLocationInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('customer_locations')
    .select('id, label, latitude, longitude, delivery_note, city_id, zone_id')
    .eq('id', id)
    .eq('customer_id', cid)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const touchesLocation =
    parsed.data.latitude !== undefined ||
    parsed.data.longitude !== undefined ||
    parsed.data.label !== undefined ||
    parsed.data.delivery_note !== undefined ||
    parsed.data.city_id !== undefined ||
    parsed.data.zone_id !== undefined

  if (touchesLocation) {
    const latitude = parsed.data.latitude ?? (existing as { latitude: number }).latitude
    const longitude = parsed.data.longitude ?? (existing as { longitude: number }).longitude
    const label = parsed.data.label ?? (existing as { label: string }).label
    const deliveryNote = parsed.data.delivery_note !== undefined ? parsed.data.delivery_note : (existing as { delivery_note: string | null }).delivery_note
    const cityId = parsed.data.city_id !== undefined ? parsed.data.city_id : (existing as { city_id: string | null }).city_id
    const zoneId = parsed.data.zone_id !== undefined ? parsed.data.zone_id : (existing as { zone_id: string | null }).zone_id

    const { error } = await db.from('customer_locations').update({
      label,
      latitude,
      longitude,
      delivery_note: deliveryNote,
      city_id: cityId,
      zone_id: zoneId,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('customer_id', cid)
    if (error) return NextResponse.json({ error: 'Could not update location' }, { status: 500 })
  }

  if (parsed.data.is_active === true) {
    const now = new Date().toISOString()
    await db
      .from('customer_locations')
      .update({ is_active: false, updated_at: now })
      .eq('customer_id', cid)
      .eq('is_active', true)
    await db
      .from('customer_locations')
      .update({ is_active: true, updated_at: now })
      .eq('id', id)
      .eq('customer_id', cid)
  } else if (parsed.data.is_active === false) {
    await db
      .from('customer_locations')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('customer_id', cid)
  }

  const { data } = await db.from('customer_locations').select(SELECT).eq('id', id).eq('customer_id', cid).single()
  return NextResponse.json({ location: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cid = await customerId()
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseAdmin()
  const { error } = await db.from('customer_locations').delete().eq('id', id).eq('customer_id', cid)
  if (error) return NextResponse.json({ error: 'Could not delete location' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
