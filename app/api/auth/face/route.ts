import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { detectImageMime } from '@/lib/security'
import { MAX_IMAGE_BYTES } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { isValidDoc } from '@/lib/kyc'

export const runtime = 'nodejs'

const BUCKET = 'kyc-faces'

// POST /api/auth/face — multipart 'file'. The signed-in user's KYC selfie (fraud
// record). Stored PRIVATELY at <userId>.webp — never public, admins view via a
// short-lived signed URL (GET /api/admin/face). Validates magic bytes, strips
// EXIF (incl. GPS) and resizes small via sharp, so it's light + privacy-safe.
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.userId) return NextResponse.json({ error: 'No account' }, { status: 400 })

  const rl = await rateLimitGeneric(`face:${session.userId}`, 10, 600)
  if (!rl.success) return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })

  let file: File | null = null
  let doc = 'face'
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const d = form.get('doc')
    if (typeof d === 'string' && d) doc = d
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }
  // Only vendors/riders submit KYC docs, and only known doc types.
  if (!isValidDoc(session.role, doc)) {
    return NextResponse.json({ error: 'This document is not required for your account' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Photo too large (max 5MB)' }, { status: 400 })

  const inputBuf = Buffer.from(await file.arrayBuffer())
  if (!detectImageMime(inputBuf)) {
    return NextResponse.json({ error: 'Invalid image — use a real photo (JPG/PNG)' }, { status: 400 })
  }

  let out: Buffer
  try {
    out = await sharp(inputBuf)
      .rotate()                                   // honour EXIF orientation, then drop EXIF (incl. GPS)
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 78 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not process photo' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  // New/updated docs land in pending/ and await admin verification. A re-upload
  // also drops any previously-verified copy, so a changed doc is re-reviewed.
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(`pending/${session.userId}/${doc}.webp`, out, { contentType: 'image/webp', upsert: true })
  if (upErr) {
    console.error('[auth/face] storage error:', upErr.message)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
  await db.storage.from(BUCKET).remove([`verified/${session.userId}/${doc}.webp`]).catch(() => {})

  return NextResponse.json({ success: true, doc, status: 'pending' })
}
