import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { getFeature } from '@/lib/features'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { detectImageMime } from '@/lib/security'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { DEFAULT_VIDEO_QUOTA } from '@/lib/feed/quota'
import { ensureSocialProfileForSession } from '@/lib/feed/service'
import { canCreateStory, canPublishFeedPost, loadFeedPermissionContext } from '@/lib/feed/permissions'
import { feedUploadInput, feedVideoUploadPrepareInput } from '@/lib/feed/validators'
import { ZodError } from 'zod'

export const runtime = 'nodejs'

const BUCKET = 'feed-media'
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_VIDEOS = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

function normalizeVideoMime(mime: string) {
  return mime === 'video/x-m4v' ? 'video/mp4' : mime
}

function videoExtension(mime: string, fileName = '') {
  if (mime === 'video/webm') return 'webm'
  if (mime === 'video/quicktime' || /\.mov$/i.test(fileName)) return 'mov'
  return 'mp4'
}

async function ensureFeedBucket(db: ReturnType<typeof createSupabaseAdmin>) {
  const { data } = await db.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: DEFAULT_VIDEO_QUOTA.maxVideoSizeBytes,
    allowedMimeTypes: [...ALLOWED_IMAGES, ...ALLOWED_VIDEOS],
  })
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message)
}

async function canUploadForPurpose(
  db: ReturnType<typeof createSupabaseAdmin>,
  profileId: string,
  purpose: 'post' | 'story' | undefined,
) {
  if (!purpose) return true
  const context = await loadFeedPermissionContext(db, profileId)
  return purpose === 'post'
    ? canPublishFeedPost(context.profile, context.vendor)
    : canCreateStory(context.profile, context.vendor)
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_posting_enabled'))) {
    return NextResponse.json({ error: 'Feed posting is disabled' }, { status: 503 })
  }

  const rl = await rateLimitGeneric(`feed-upload:${session.userId ?? session.phone}`, 30, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many uploads. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const profile = await ensureSocialProfileForSession()
  if (!profile) return NextResponse.json({ error: 'Could not resolve profile' }, { status: 500 })

  if (req.headers.get('content-type')?.includes('application/json')) {
    let parsed
    try {
      parsed = feedVideoUploadPrepareInput.parse(await req.json())
    } catch (err) {
      if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid video upload' }, { status: 400 })
      return NextResponse.json({ error: 'Invalid video upload' }, { status: 400 })
    }

    if (!(await canUploadForPurpose(db, profile.id, parsed.purpose))) {
      return NextResponse.json({ error: 'This account cannot upload for that feed destination' }, { status: 403 })
    }
    if (parsed.size_bytes > DEFAULT_VIDEO_QUOTA.maxVideoSizeBytes) {
      return NextResponse.json({ error: `Video is too large (max ${Math.floor(DEFAULT_VIDEO_QUOTA.maxVideoSizeBytes / 1024 / 1024)} MB)` }, { status: 400 })
    }
    if (parsed.duration_seconds > DEFAULT_VIDEO_QUOTA.maxVideoDurationSeconds) {
      return NextResponse.json({ error: `Video is too long (max ${DEFAULT_VIDEO_QUOTA.maxVideoDurationSeconds} seconds)` }, { status: 400 })
    }

    const mime = normalizeVideoMime(parsed.mime_type)
    const storagePath = `${profile.id}/${crypto.randomUUID()}.${videoExtension(mime, parsed.file_name)}`
    try {
      await ensureFeedBucket(db)
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(storagePath)
      if (error || !data?.token) throw new Error(error?.message ?? 'Could not prepare upload')
      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(storagePath)
      return NextResponse.json({
        storage_path: storagePath,
        public_url: pub.publicUrl,
        mime_type: mime,
        duration_seconds: parsed.duration_seconds,
        media_kind: 'video',
        upload_token: data.token,
      })
    } catch (error) {
      console.error('[feed/uploads] signed upload error:', error instanceof Error ? error.message : error)
      return NextResponse.json({ error: 'Could not prepare video upload' }, { status: 500 })
    }
  }

  let file: File | null = null
  let extra: Record<string, unknown> = {}
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const meta = form.get('meta')
    if (typeof meta === 'string' && meta.trim()) extra = JSON.parse(meta) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  let parsed
  try {
    parsed = feedUploadInput.parse(extra)
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid upload metadata' }, { status: 400 })
    return NextResponse.json({ error: 'Invalid upload metadata' }, { status: 400 })
  }

  let videoDurationSeconds: number | null = null
  if (parsed.media_kind === 'video') {
    const durationSeconds = parsed.duration_seconds
    if (typeof durationSeconds !== 'number') {
      return NextResponse.json({ error: 'Video duration is required' }, { status: 400 })
    }
    videoDurationSeconds = durationSeconds
    if (durationSeconds > DEFAULT_VIDEO_QUOTA.maxVideoDurationSeconds) {
      return NextResponse.json({ error: `Video too long (max ${DEFAULT_VIDEO_QUOTA.maxVideoDurationSeconds}s)` }, { status: 400 })
    }
  }

  const maxBytes = parsed.media_kind === 'video' ? DEFAULT_VIDEO_QUOTA.maxVideoSizeBytes : DEFAULT_VIDEO_QUOTA.imageLimits.maxBytes
  if (file.size > maxBytes) {
    return NextResponse.json({ error: parsed.media_kind === 'video' ? 'Video too large' : 'Image too large' }, { status: 400 })
  }

  const inputBuf = Buffer.from(await file.arrayBuffer())
  const ft = await fileTypeFromBuffer(inputBuf)
  const mime = ft?.mime ?? file.type
  if (!mime) return NextResponse.json({ error: 'Could not detect file type' }, { status: 400 })

  const bucketPathId = crypto.randomUUID()

  if (!(await canUploadForPurpose(db, profile.id, parsed.purpose))) {
    return NextResponse.json({ error: 'This account cannot upload for that feed destination' }, { status: 403 })
  }

  let out: Buffer = inputBuf
  let contentType = mime
  let storagePath = `${profile.id}/${bucketPathId}`
  let width: number | null = null
  let height: number | null = null

  if (parsed.media_kind === 'image') {
    if (!ALLOWED_IMAGES.has(mime) || !detectImageMime(inputBuf)) {
      return NextResponse.json({ error: 'Invalid image â€” must be JPG, PNG, or WebP' }, { status: 400 })
    }
    const processed = await sharp(inputBuf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
    out = processed.data
    contentType = 'image/webp'
    storagePath = `${profile.id}/${bucketPathId}.webp`
    width = processed.info.width ?? null
    height = processed.info.height ?? null
  } else {
    if (!ALLOWED_VIDEOS.has(mime)) {
      return NextResponse.json({ error: 'Invalid video â€” must be MP4, WebM, or MOV' }, { status: 400 })
    }
    storagePath = `${profile.id}/${bucketPathId}.${ft?.ext ?? 'mp4'}`
  }

  let { error: uploadErr } = await db.storage.from(BUCKET).upload(storagePath, out, { contentType, upsert: false })
  if (uploadErr && /bucket.*not found|not found.*bucket/i.test(uploadErr.message)) {
    await db.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: DEFAULT_VIDEO_QUOTA.maxVideoSizeBytes,
      allowedMimeTypes: [...ALLOWED_IMAGES, ...ALLOWED_VIDEOS],
    })
    uploadErr = (await db.storage.from(BUCKET).upload(storagePath, out, { contentType, upsert: false })).error
  }
  if (uploadErr) {
    console.error('[feed/uploads] storage error:', uploadErr.message)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(storagePath)
  return NextResponse.json({
    storage_path: storagePath,
    public_url: pub.publicUrl,
    mime_type: contentType,
    width,
    height,
    duration_seconds: parsed.media_kind === 'video' ? videoDurationSeconds : null,
    media_kind: parsed.media_kind,
  })
}
