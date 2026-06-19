import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import sharp from 'sharp'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { detectImageMime } from '@/lib/security'
import { MAX_IMAGE_BYTES } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'

// sharp needs the Node runtime (not Edge).
export const runtime = 'nodejs'

const BUCKET = 'menu-images'

// POST /api/profile/image — multipart { file, slot: 'avatar' | 'cover' }.
// Validates magic bytes, resizes via sharp, uploads to Storage, and saves the
// resulting URL onto the CURRENT user's own row:
//   • customer / rider → avatar_url
//   • vendor → logo_url (avatar) or shop_photo_url (cover)
// Returns { url }. Cover is vendor-only.
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = session.role
  if (role !== 'customer' && role !== 'vendor' && role !== 'rider') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`profile-image:${session.userId ?? session.phone}`, 20, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many uploads. Please slow down.' }, { status: 429 })

  let file: File | null = null
  let slot = 'avatar'
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const s = form.get('slot')
    if (typeof s === 'string') slot = s
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (slot !== 'avatar' && slot !== 'cover') return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })
  if (slot === 'cover' && role !== 'vendor') return NextResponse.json({ error: 'Cover photo is for vendors' }, { status: 403 })
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 400 })

  const inputBuf = Buffer.from(await file.arrayBuffer())

  // Magic-byte check — never trust the client-declared content type.
  if (!detectImageMime(inputBuf)) {
    return NextResponse.json({ error: 'Invalid image — must be JPG, PNG, or WebP' }, { status: 400 })
  }

  let out: Buffer
  try {
    const pipeline = sharp(inputBuf).rotate() // honor EXIF orientation
    if (slot === 'cover') pipeline.resize(1280, 480, { fit: 'cover' })
    else pipeline.resize(512, 512, { fit: 'cover' })
    out = await pipeline.webp({ quality: 82 }).toBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not process image' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const path = `profiles/${role}/${session.userId ?? 'u'}/${slot}-${crypto.randomUUID()}.webp`
  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(path, out, { contentType: 'image/webp', upsert: false })

  if (uploadErr) {
    console.error('[profile/image] storage error:', uploadErr.message)
    return NextResponse.json(
      { error: 'Upload failed — make sure the "menu-images" storage bucket exists and is public.' },
      { status: 500 }
    )
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
  const url = pub.publicUrl

  // Save onto the current user's own row (keyed by their session phone + role).
  const table = role === 'customer' ? 'customers' : role === 'rider' ? 'riders' : 'vendors'
  const column = role === 'vendor' ? (slot === 'cover' ? 'shop_photo_url' : 'logo_url') : 'avatar_url'
  const { error: updErr } = await db.from(table).update({ [column]: url }).eq('phone', session.phone)
  if (updErr) {
    console.error('[profile/image] db error:', updErr.message)
    return NextResponse.json({ error: 'Could not save image' }, { status: 500 })
  }

  return NextResponse.json({ url })
}

// DELETE /api/profile/image?slot=avatar|cover — clears the picture.
// Compulsory pictures can't be removed: a rider's avatar and a vendor's logo are
// required (replace-only). Customers may remove their avatar; vendors may remove
// the (optional) cover photo.
export async function DELETE(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = session.role
  const slot = new URL(req.url).searchParams.get('slot') ?? 'avatar'
  if (slot !== 'avatar' && slot !== 'cover') return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })

  if (role === 'rider') {
    return NextResponse.json({ error: 'Your profile photo is required and can only be changed.' }, { status: 403 })
  }
  if (role === 'vendor' && slot === 'avatar') {
    return NextResponse.json({ error: 'Your store logo is required and can only be changed.' }, { status: 403 })
  }
  if (role === 'customer' && slot === 'cover') {
    return NextResponse.json({ error: 'No cover photo' }, { status: 400 })
  }
  if (role !== 'customer' && role !== 'vendor') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const table = role === 'customer' ? 'customers' : 'vendors'
  const column = role === 'vendor' ? 'shop_photo_url' : 'avatar_url'
  const { error } = await db.from(table).update({ [column]: null }).eq('phone', session.phone)
  if (error) {
    console.error('[profile/image] delete error:', error.message)
    return NextResponse.json({ error: 'Could not remove image' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
