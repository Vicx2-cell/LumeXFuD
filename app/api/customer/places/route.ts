import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createSavedPlaceInput } from '@/lib/validators'
import { cleanPlaceFields, canAddPlace, sortPlaces, photoPathBelongsTo, type SavedPlace } from '@/lib/saved-places'
import { rateLimitGeneric } from '@/lib/rate-limit'

const PHOTO_BUCKET = 'place-photos'
const SELECT = 'id, label, landmark, latitude, longitude, photo_path, is_default, use_count, last_used_at, created_at'

// Resolve the signed-in CUSTOMER's id. Saved places are customer-only.
async function customerId(): Promise<string | null> {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return null
  if (session.userId) return session.userId
  const db = createSupabaseAdmin()
  const { data } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// Swap each row's private storage key for a short-lived signed URL the page can
// render. Failures degrade to a null photo — never break the list.
async function withSignedPhotos(rows: SavedPlace[]): Promise<(SavedPlace & { photo_url: string | null })[]> {
  const db = createSupabaseAdmin()
  return Promise.all(
    rows.map(async (r) => {
      let photo_url: string | null = null
      if (r.photo_path) {
        const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(r.photo_path, 300)
        photo_url = data?.signedUrl ?? null
      }
      return { ...r, photo_url }
    })
  )
}

// GET /api/customer/places — the customer's saved places, "your usual" first.
// Degrades to an empty list if migration 076 hasn't run.
export async function GET() {
  const cid = await customerId()
  if (!cid) return NextResponse.json({ places: [] })

  try {
    const db = createSupabaseAdmin()
    const { data, error } = await db
      .from('saved_places')
      .select(SELECT)
      .eq('customer_id', cid)
    if (error) return NextResponse.json({ places: [] })

    const places = await withSignedPhotos(sortPlaces((data ?? []) as SavedPlace[]))
    return NextResponse.json({ places })
  } catch {
    return NextResponse.json({ places: [] })
  }
}

// POST /api/customer/places — save a new place (ownership is implicit: it's
// written under the caller's customer id, never a client-supplied one).
export async function POST(req: NextRequest) {
  const cid = await customerId()
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`places:write:${cid}`, 30, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many changes. Please slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = createSavedPlaceInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const clean = cleanPlaceFields(parsed.data)
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })

  // A supplied photo must live in the caller's OWN upload folder (IDOR guard).
  if (parsed.data.photo_path && !photoPathBelongsTo(parsed.data.photo_path, cid)) {
    return NextResponse.json({ error: 'Invalid photo' }, { status: 400 })
  }

  const db = createSupabaseAdmin()

  const { count } = await db
    .from('saved_places')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', cid)
  if (!canAddPlace(count ?? 0)) {
    return NextResponse.json({ error: 'You’ve reached the saved-places limit' }, { status: 400 })
  }

  const { data, error } = await db
    .from('saved_places')
    .insert({
      customer_id: cid,
      label: clean.value.label,
      landmark: clean.value.landmark,
      latitude: clean.value.latitude,
      longitude: clean.value.longitude,
      photo_path: parsed.data.photo_path ?? null,
    })
    .select(SELECT)
    .single()

  if (error || !data) {
    // 23505 = unique_violation on (customer_id, label).
    if ((error as { code?: string } | null)?.code === '23505') {
      return NextResponse.json({ error: 'You already saved a place with that label' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not save place' }, { status: 500 })
  }

  // Honor "make this my usual" atomically (clears any prior default).
  if (parsed.data.is_default) {
    await db.rpc('set_default_place', { p_customer_id: cid, p_place_id: (data as SavedPlace).id })
    ;(data as SavedPlace).is_default = true
  }

  return NextResponse.json({ place: data })
}
