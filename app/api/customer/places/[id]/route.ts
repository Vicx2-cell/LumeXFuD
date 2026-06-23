import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { updateSavedPlaceInput } from '@/lib/validators'
import { cleanPlaceFields, photoPathBelongsTo } from '@/lib/saved-places'
import { rateLimitGeneric } from '@/lib/rate-limit'

const PHOTO_BUCKET = 'place-photos'
const SELECT = 'id, label, landmark, latitude, longitude, photo_path, is_default, use_count, last_used_at, created_at'

async function customerId(): Promise<string | null> {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return null
  if (session.userId) return session.userId
  const db = createSupabaseAdmin()
  const { data } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// PATCH /api/customer/places/[id] — edit fields and/or set "your usual".
// Ownership: every query is scoped to the caller's customer_id, so a customer can
// never read or mutate another customer's place (BOLA prevention, rule #8).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cid = await customerId()
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`places:write:${cid}`, 30, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many changes. Please slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = updateSavedPlaceInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const db = createSupabaseAdmin()

  // Confirm the place belongs to this customer before touching anything.
  const { data: existing } = await db
    .from('saved_places')
    .select('id')
    .eq('id', id)
    .eq('customer_id', cid)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Build the column update from whatever subset was sent. Coords + label + the
  // landmark go through cleanPlaceFields when any of them is present.
  const update: Record<string, unknown> = {}
  const touchesFields =
    parsed.data.label !== undefined || parsed.data.landmark !== undefined ||
    parsed.data.latitude !== undefined || parsed.data.longitude !== undefined
  if (touchesFields) {
    // Pull current values so a partial edit doesn't trip the half-pin rule.
    const { data: cur } = await db
      .from('saved_places')
      .select('label, landmark, latitude, longitude')
      .eq('id', id).eq('customer_id', cid).single()
    const c = cur as { label: string; landmark: string | null; latitude: number | null; longitude: number | null }
    const clean = cleanPlaceFields({
      label:     parsed.data.label     ?? c.label,
      landmark:  parsed.data.landmark  !== undefined ? parsed.data.landmark  : c.landmark,
      latitude:  parsed.data.latitude  !== undefined ? parsed.data.latitude  : c.latitude,
      longitude: parsed.data.longitude !== undefined ? parsed.data.longitude : c.longitude,
    })
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
    update.label = clean.value.label
    update.landmark = clean.value.landmark
    update.latitude = clean.value.latitude
    update.longitude = clean.value.longitude
  }
  if (parsed.data.photo_path !== undefined) {
    // null clears the photo; a non-null path must be in the caller's own folder.
    if (parsed.data.photo_path !== null && !photoPathBelongsTo(parsed.data.photo_path, cid)) {
      return NextResponse.json({ error: 'Invalid photo' }, { status: 400 })
    }
    update.photo_path = parsed.data.photo_path
  }

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString()
    const { error } = await db
      .from('saved_places')
      .update(update)
      .eq('id', id).eq('customer_id', cid)
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'You already saved a place with that label' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Could not update place' }, { status: 500 })
    }
  }

  // Setting (or clearing) "your usual" is atomic via the RPC.
  if (parsed.data.is_default === true) {
    await db.rpc('set_default_place', { p_customer_id: cid, p_place_id: id })
  } else if (parsed.data.is_default === false) {
    await db.from('saved_places').update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('id', id).eq('customer_id', cid)
  }

  const { data } = await db.from('saved_places').select(SELECT).eq('id', id).eq('customer_id', cid).single()
  return NextResponse.json({ place: data })
}

// DELETE /api/customer/places/[id] — remove a place (and its photo). Ownership-scoped.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cid = await customerId()
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('saved_places')
    .select('photo_path')
    .eq('id', id)
    .eq('customer_id', cid)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await db.from('saved_places').delete().eq('id', id).eq('customer_id', cid)
  if (error) return NextResponse.json({ error: 'Could not delete place' }, { status: 500 })

  // Best-effort photo cleanup — the row is already gone, so never fail on this.
  const path = (existing as { photo_path: string | null }).photo_path
  if (path) await db.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {})

  return NextResponse.json({ ok: true })
}
