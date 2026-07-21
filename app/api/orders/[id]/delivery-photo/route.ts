import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import sharp from 'sharp'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { detectImageMime } from '@/lib/security'
import { MAX_IMAGE_BYTES } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { recordSecurityEvent } from '@/lib/security-events'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

// sharp needs the Node runtime (not Edge).
export const runtime = 'nodejs'
const BUCKET = 'menu-images' // existing public bucket; proof photos live under delivery-proof/

// POST /api/orders/[id]/delivery-photo — OPTIONAL leave-at-gate proof. The
// assigned rider MAY attach a photo of the drop; it is never required to confirm
// a delivery (see /deliver). Validates magic bytes, resizes via sharp, stores the
// URL on the order. Gated by delivery_handover_v1, bound to the order's rider.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  if (!(await getFeature('delivery_handover_v1'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rider', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`delivery-photo:${id}`, 10, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many uploads. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, rider_id, delivery_type')
    .eq('id', id)
    .single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership: only the assigned rider (or staff) may attach proof.
  if (session.role === 'rider' && session.userId !== order.rider_id) {
    await recordSecurityEvent({
      eventType: 'stale_rider_access', severity: 'warn', surface: 'orders.delivery_photo',
      actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
      ip: req.headers.get('x-forwarded-for'), requestId: context.requestId,
      correlationId: context.correlationId, route: req.nextUrl.pathname, method: req.method,
      resourceType: 'order', resourceId: id, outcome: 'not_current_rider',
    })
    return json({ error: 'Not your delivery' }, { status: 403 })
  }
  if (order.delivery_type === 'PICKUP') {
    return NextResponse.json({ error: 'Pickup orders have no delivery photo.' }, { status: 400 })
  }

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 400 })

  const inputBuf = Buffer.from(await file.arrayBuffer())
  if (!detectImageMime(inputBuf)) {
    return NextResponse.json({ error: 'Invalid image — must be JPG, PNG, or WebP' }, { status: 400 })
  }

  let out: Buffer
  try {
    out = await sharp(inputBuf).rotate().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not process image' }, { status: 400 })
  }

  const path = `delivery-proof/${id}/${crypto.randomUUID()}.webp`
  const { error: uploadErr } = await db.storage.from(BUCKET).upload(path, out, { contentType: 'image/webp', upsert: false })
  if (uploadErr) {
    console.error('[delivery-photo] storage error:', uploadErr.message)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
  let updateQuery = db.from('orders')
    .update({ delivery_photo_url: pub.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['RIDER_ASSIGNED', 'PICKED_UP'])
  if (session.role === 'rider') updateQuery = updateQuery.eq('rider_id', session.userId!)
  const { data: claimed } = await updateQuery.select('id').maybeSingle()
  if (!claimed) {
    await db.storage.from(BUCKET).remove([path])
    if (session.role === 'rider') {
      await recordSecurityEvent({
        eventType: 'stale_rider_access', severity: 'warn', surface: 'orders.delivery_photo',
        actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
        ip: req.headers.get('x-forwarded-for'), requestId: context.requestId,
        correlationId: context.correlationId, route: req.nextUrl.pathname, method: req.method,
        resourceType: 'order', resourceId: id, outcome: 'reassigned_during_upload',
      })
    }
    return json({ error: 'Delivery assignment changed. Refresh and try again.' }, { status: 409 })
  }

  return json({ url: pub.publicUrl })
}
