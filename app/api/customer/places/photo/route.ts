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

const BUCKET = 'place-photos'

// POST /api/customer/places/photo — multipart 'file'. Validates magic bytes,
// resizes to webp, uploads to the PRIVATE place-photos bucket under the caller's
// own folder, and returns the storage KEY (not a URL — the bucket is private and
// the list endpoint mints signed URLs). The key is stored on a place via POST/PATCH.
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Customers only' }, { status: 403 })
  // The folder IS the ownership boundary (see photoPathBelongsTo), so the upload
  // must be scoped to a concrete customer id — never a fallback bucket.
  if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`place-photo:${session.userId}`, 20, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many uploads. Please slow down.' }, { status: 429 })

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

  // Magic-byte check — never trust the client-declared content type.
  if (!detectImageMime(inputBuf)) {
    return NextResponse.json({ error: 'Invalid image — must be JPG, PNG, or WebP' }, { status: 400 })
  }

  let out: Buffer
  try {
    out = await sharp(inputBuf)
      .rotate() // honor EXIF orientation
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not process image' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const path = `${session.userId}/${crypto.randomUUID()}.webp`
  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(path, out, { contentType: 'image/webp', upsert: false })

  if (uploadErr) {
    console.error('[places/photo] storage error:', uploadErr.message)
    return NextResponse.json(
      { error: 'Upload failed — make sure the "place-photos" storage bucket exists (migration 076).' },
      { status: 500 }
    )
  }

  return NextResponse.json({ path })
}
