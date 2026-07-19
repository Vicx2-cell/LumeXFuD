'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ImageIcon, Loader2, Play, Type, Video, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type ComposerMode = 'post' | 'story'
type PickedMedia = {
  file: File
  kind: 'image' | 'video'
  previewUrl: string
  durationSeconds?: number
}
type UploadResult = {
  storage_path: string
  public_url: string
  mime_type: string
  width: number | null
  height: number | null
  duration_seconds: number | null
  media_kind: 'image' | 'video'
  upload_token?: string
}

function videoMime(file: File) {
  if (file.type === 'video/x-m4v') return 'video/x-m4v'
  if (file.type === 'video/webm') return 'video/webm'
  if (file.type === 'video/quicktime' || /\.mov$/i.test(file.name)) return 'video/quicktime'
  return 'video/mp4'
}

function getVideoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Math.max(1, Math.ceil(video.duration || 1)))
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read video'))
    }
    video.src = url
  })
}

export default function FeedV2CreatePage() {
  const searchParams = useSearchParams()
  const initialMode = searchParams.get('mode') === 'story' ? 'story' : 'post'
  const [mode, setMode] = useState<ComposerMode>(initialMode)
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [media, setMedia] = useState<PickedMedia | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const roleLoading = viewerRole === null
  const storyOnly = roleLoading || viewerRole === 'customer'
  const publishingBlocked = viewerRole === 'rider'

  useEffect(() => {
    return () => {
      if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl)
    }
  }, [media?.previewUrl])

  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null
        return res.json().catch(() => null)
      })
      .then((json) => {
        const role = json && typeof json === 'object' ? (json as { role?: string }).role ?? null : null
        setViewerRole(role)
        if (role === 'customer') setMode('story')
      })
      .catch(() => {})
  }, [])

  const hasText = Boolean(body.trim())
  const canSubmit = !roleLoading && !publishingBlocked && Boolean(hasText || media)
  const composerModes: ComposerMode[] = publishingBlocked ? [] : storyOnly ? ['story'] : ['post', 'story']

  async function pickMedia(event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'video') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setMessage('')
    if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl)

    try {
      const durationSeconds = kind === 'video' ? await getVideoDuration(file) : undefined
      setMedia({
        file,
        kind,
        previewUrl: URL.createObjectURL(file),
        durationSeconds,
      })
    } catch {
      setMessage('Could not read that video. Try another one.')
    }
  }

  async function uploadMedia(picked: PickedMedia) {
    if (picked.kind === 'video') {
      const prepareRes = await fetch('/api/feed/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare_video',
          file_name: picked.file.name,
          mime_type: videoMime(picked.file),
          size_bytes: picked.file.size,
          duration_seconds: picked.durationSeconds ?? 1,
          purpose: mode,
        }),
      })
      const prepared = await prepareRes.json().catch(() => ({})) as Partial<UploadResult> & { error?: string }
      if (!prepareRes.ok || !prepared.storage_path || !prepared.public_url || !prepared.upload_token || !prepared.mime_type) {
        throw new Error(prepared.error ?? 'Could not prepare video upload')
      }

      const supabase = createSupabaseBrowserClient()
      const uploadFile = picked.file.type === prepared.mime_type
        ? picked.file
        : new File([picked.file], picked.file.name, { type: prepared.mime_type })
      const { error } = await supabase.storage
        .from('feed-media')
        .uploadToSignedUrl(prepared.storage_path, prepared.upload_token, uploadFile, {
          contentType: prepared.mime_type,
          upsert: false,
        })
      if (error) throw new Error(error.message || 'Video upload failed')
      return prepared as UploadResult
    }

    const form = new FormData()
    form.append('file', picked.file)
    form.append('meta', JSON.stringify({
      media_kind: picked.kind,
      purpose: mode,
    }))

    const res = await fetch('/api/feed/uploads', {
      method: 'POST',
      body: form,
    })
    const json = await res.json().catch(() => ({})) as Partial<UploadResult> & { error?: string }
    if (!res.ok || !json.public_url || !json.media_kind) {
      throw new Error(json.error ?? 'Upload failed')
    }
    return json as UploadResult
  }

  async function submit() {
    if (!canSubmit || busy || publishingBlocked) return
    setBusy(true)
    setMessage('')

    try {
      const uploaded = media ? await uploadMedia(media) : null
      const res = await fetch(mode === 'post' && !storyOnly ? '/api/feed/posts' : '/api/feed/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'post' && !storyOnly
          ? {
              body: body.trim() || undefined,
              post_kind: uploaded?.media_kind === 'video' ? 'VIDEO' : uploaded ? 'IMAGE' : 'TEXT',
              media: uploaded ? [{
                kind: uploaded.media_kind,
                public_url: uploaded.public_url,
                storage_path: uploaded.storage_path,
                mime_type: uploaded.mime_type,
                width: uploaded.width ?? undefined,
                height: uploaded.height ?? undefined,
                duration_seconds: uploaded.duration_seconds ?? undefined,
                is_primary: true,
              }] : [],
              hashtags: [],
              mentions: [],
              menu_items: [],
              mode: 'publish',
            }
          : {
              caption: body.trim() || undefined,
              media_url: uploaded?.public_url,
              media_kind: uploaded?.media_kind ?? 'image',
            }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; status?: string }
      if (!res.ok) {
        setMessage(json.error ?? 'Could not submit.')
        return
      }

      setBody('')
      if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl)
      setMedia(null)
      setMessage(mode === 'story' && json.status === 'under_review' ? 'Story sent for review.' : 'Published.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lx-page min-h-screen px-4 py-6 text-white">
      <section className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/8 bg-[#0d0f14]/95 shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
        <header className="flex items-center justify-between gap-4 border-b border-white/6 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Create</p>
            <h1 className="mt-1 text-xl font-semibold">{mode === 'story' ? 'New story' : 'New post'}</h1>
          </div>
          <Link href="/feed-v2" className="grid h-10 w-10 place-items-center rounded-full bg-white/6 text-white/75 transition hover:bg-white/10 hover:text-white" aria-label="Back to feed">
            <X size={18} aria-hidden="true" />
          </Link>
        </header>

        <div className={`grid bg-black/20 p-1 ${storyOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {composerModes.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item)
                setMessage('')
              }}
              className={`rounded-full px-4 py-2.5 text-sm font-semibold transition ${mode === item ? 'bg-[#F5A623] text-black' : 'text-white/55 hover:text-white'}`}
            >
              {item === 'post' ? 'Feed post' : 'Story'}
            </button>
          ))}
        </div>

        {roleLoading ? <p className="px-5 pt-4 text-sm text-white/48">Loading your publishing options…</p> : null}
        {publishingBlocked ? <p className="px-5 py-6 text-sm text-white/60">Rider accounts cannot publish feed posts or stories.</p> : null}
        {viewerRole === 'customer' ? <p className="px-5 pt-4 text-sm text-white/48">Customer stories are reviewed by an admin before they appear.</p> : null}

        {!publishingBlocked ? <div className="p-5">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={mode === 'story' ? 5 : 6}
            className="min-h-36 w-full resize-none border-0 bg-transparent text-[1.45rem] leading-tight text-white outline-none placeholder:text-white/28"
            placeholder={mode === 'story' ? 'Drop a quick campus story...' : 'What is happening on campus?'}
          />

          {media ? (
            <div className="relative mt-4 overflow-hidden rounded-[1.4rem] border border-white/8 bg-black">
              {media.kind === 'video' ? (
                <video src={media.previewUrl} className="max-h-[420px] w-full bg-black object-contain" controls playsInline />
              ) : (
                <img src={media.previewUrl} alt="Selected upload preview" className="max-h-[420px] w-full object-contain" />
              )}
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(media.previewUrl)
                  setMedia(null)
                }}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/80"
                aria-label="Remove selected media"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(event) => void pickMedia(event, 'image')} />
          <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="hidden" onChange={(event) => void pickMedia(event, 'video')} />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                <ImageIcon size={16} aria-hidden="true" />
                Photo
              </button>
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                <Video size={16} aria-hidden="true" />
                Video
              </button>
              <button
                type="button"
                onClick={() => {
                  if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl)
                  setMedia(null)
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                <Type size={16} aria-hidden="true" />
                Text
              </button>
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || busy}
              className="inline-flex min-w-32 items-center justify-center gap-2 rounded-full bg-[#F5A623] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : media?.kind === 'video' ? <Play size={15} aria-hidden="true" /> : null}
              {busy ? 'Sending' : mode === 'story' ? 'Share story' : 'Post'}
            </button>
          </div>

          {message ? <p className="mt-4 text-sm text-white/60">{message}</p> : null}
          {mode === 'story' ? (
            <p className="mt-4 text-xs leading-relaxed text-white/35">
              Customer stories go to review first. Vendor, ambassador, and LumeX official stories publish immediately.
            </p>
          ) : null}
        </div> : null}
      </section>
    </main>
  )
}
