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

// POST /api/upload/menu-image — multipart 'file'. Validates magic bytes, resizes
// to webp via sharp, uploads to Supabase Storage, returns the public URL.
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const rl = await rateLimitGeneric(`menu-image:${session.userId ?? session.phone}`, 30, 300)
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
    console.error('[upload/menu-image] storage error:', uploadErr.message)
    return NextResponse.json(
      { error: 'Upload failed — make sure the "menu-images" storage bucket exists and is public.' },
      { status: 500 }
    )
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: pub.publicUrl })
}
