'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Eye, ImageIcon, Loader2, Play, Save, Type, Video, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type ComposerMode = 'post' | 'story'
type PickedMedia = {
  file?: File
  kind: 'image' | 'video'
  previewUrl: string
  durationSeconds?: number
  uploaded?: UploadResult
  revokePreview?: boolean
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
type VendorMenuItem = {
  id: string
  name: string
  price_kobo: number
  image_url: string | null
  is_available: boolean
  sold_out_until: string | null
}
type EditablePost = {
  id: string
  body: string | null
  post_media?: Array<{
    media_kind: 'image' | 'video'
    storage_path: string | null
    public_url: string | null
    mime_type: string | null
    width: number | null
    height: number | null
    duration_seconds: number | null
  }>
  post_menu_items?: Array<{ menu_item_id: string }>
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
  const editPostId = searchParams.get('edit')
  const [mode, setMode] = useState<ComposerMode>(initialMode)
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [media, setMedia] = useState<PickedMedia | null>(null)
  const [menuItems, setMenuItems] = useState<VendorMenuItem[]>([])
  const [selectedMenuItemId, setSelectedMenuItemId] = useState('')
  const [draftId, setDraftId] = useState<string | null>(editPostId)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const roleLoading = viewerRole === null
  const storyOnly = roleLoading || viewerRole === 'customer'
  const publishingBlocked = viewerRole === 'rider' || viewerRole === 'anonymous'

  useEffect(() => {
    return () => {
      if (media?.revokePreview && media.previewUrl) URL.revokeObjectURL(media.previewUrl)
    }
  }, [media?.previewUrl, media?.revokePreview])

  useEffect(() => {
    void (async () => {
      try {
        const authRes = await fetch('/api/auth/me', { cache: 'no-store' })
        const auth = authRes.ok ? await authRes.json().catch(() => null) as { role?: string } | null : null
        const role = auth?.role ?? 'anonymous'
        setViewerRole(role)
        if (role === 'customer') setMode('story')
        if (role !== 'vendor') return

        const [menuRes, editRes] = await Promise.all([
          fetch('/api/vendor/menu', { cache: 'no-store' }),
          editPostId ? fetch(`/api/feed/posts/${editPostId}`, { cache: 'no-store' }) : Promise.resolve(null),
        ])
        if (menuRes.ok) {
          const menuJson = await menuRes.json() as { items?: VendorMenuItem[] }
          setMenuItems(menuJson.items ?? [])
        }
        if (editRes) {
          const editJson = await editRes.json().catch(() => ({})) as { post?: EditablePost; error?: string }
          if (!editRes.ok || !editJson.post) throw new Error(editJson.error ?? 'Could not load post')
          setBody(editJson.post.body ?? '')
          setDraftId(editJson.post.id)
          setSelectedMenuItemId(editJson.post.post_menu_items?.[0]?.menu_item_id ?? '')
          const existingMedia = editJson.post.post_media?.find((item) => item.public_url)
          if (existingMedia?.public_url && existingMedia.storage_path && existingMedia.mime_type) {
            setMedia({
              kind: existingMedia.media_kind,
              previewUrl: existingMedia.public_url,
              uploaded: {
                storage_path: existingMedia.storage_path,
                public_url: existingMedia.public_url,
                mime_type: existingMedia.mime_type,
                width: existingMedia.width,
                height: existingMedia.height,
                duration_seconds: existingMedia.duration_seconds,
                media_kind: existingMedia.media_kind,
              },
            })
          }
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not load publishing tools')
      }
    })()
  }, [editPostId])

  const hasText = Boolean(body.trim())
  const canSubmit = !roleLoading && !publishingBlocked && Boolean(hasText || media || selectedMenuItemId)
  const composerModes: ComposerMode[] = publishingBlocked ? [] : storyOnly ? ['story'] : ['post', 'story']
  const selectedMenuItem = menuItems.find((item) => item.id === selectedMenuItemId) ?? null

  async function pickMedia(event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'video') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setMessage('')
    if (media?.revokePreview && media.previewUrl) URL.revokeObjectURL(media.previewUrl)

    try {
      const durationSeconds = kind === 'video' ? await getVideoDuration(file) : undefined
      setMedia({
        file,
        kind,
        previewUrl: URL.createObjectURL(file),
        durationSeconds,
        revokePreview: true,
      })
    } catch {
      setMessage('Could not read that video. Try another one.')
    }
  }

  async function uploadMedia(picked: PickedMedia) {
    if (picked.uploaded) return picked.uploaded
    if (!picked.file) throw new Error('Selected media is no longer available')
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

  async function submit(saveMode: 'draft' | 'publish' = 'publish') {
    if (!canSubmit || busy || publishingBlocked) return
    setBusy(true)
    setMessage('')

    try {
      const uploaded = media ? await uploadMedia(media) : null
      const isPost = mode === 'post' && !storyOnly
      const res = await fetch(isPost ? (saveMode === 'draft' ? '/api/feed/drafts' : '/api/feed/posts') : '/api/feed/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isPost
          ? {
              draft_id: draftId ?? undefined,
              body: body.trim() || undefined,
              post_kind: selectedMenuItemId ? 'MENU_ITEM' : uploaded?.media_kind === 'video' ? 'VIDEO' : uploaded ? 'IMAGE' : 'TEXT',
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
              menu_items: selectedMenuItemId ? [{ menu_item_id: selectedMenuItemId, is_primary: true }] : [],
              mode: saveMode,
            }
          : {
              caption: body.trim() || undefined,
              media_url: uploaded?.public_url,
              media_kind: uploaded?.media_kind ?? 'image',
            }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; status?: string; postId?: string }
      if (!res.ok) {
        setMessage(json.error ?? 'Could not submit.')
        return
      }

      if (isPost && saveMode === 'draft') {
        setDraftId(json.postId ?? draftId)
        setMessage('Draft saved.')
      } else {
        setMessage(mode === 'story' && json.status === 'under_review' ? 'Story sent for review.' : draftId ? 'Post updated.' : 'Published.')
      }
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
            <h1 className="mt-1 text-xl font-semibold">{editPostId ? 'Edit post' : mode === 'story' ? 'New story' : 'New post'}</h1>
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
          {mode === 'post' ? (
            <div className="mb-4 flex justify-end">
              <button type="button" onClick={() => setPreviewing((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/6 px-4 text-sm font-semibold text-white/75" aria-pressed={previewing}>
                <Eye size={16} aria-hidden="true" /> {previewing ? 'Edit' : 'Preview'}
              </button>
            </div>
          ) : null}
          {previewing ? (
            <article className="mb-5 overflow-hidden rounded-lg border border-white/10 bg-black/25">
              <div className="px-4 py-3 text-sm font-semibold text-white/75">Post preview</div>
              {body.trim() ? <p className="whitespace-pre-wrap px-4 pb-4 text-base leading-6">{body.trim()}</p> : null}
              {media ? media.kind === 'video' ? (
                <video src={media.previewUrl} className="max-h-[420px] w-full bg-black object-contain" controls playsInline />
              ) : (
                <img src={media.previewUrl} alt="Post preview" className="max-h-[420px] w-full object-contain" />
              ) : null}
              {selectedMenuItem ? (
                <div className="m-4 flex items-center gap-3 rounded-lg border border-white/8 p-3">
                  {selectedMenuItem.image_url ? <img src={selectedMenuItem.image_url} alt="" className="h-14 w-14 rounded-md object-cover" /> : null}
                  <div className="min-w-0"><p className="truncate font-semibold">{selectedMenuItem.name}</p><p className="text-sm text-white/55">NGN {(selectedMenuItem.price_kobo / 100).toLocaleString('en-NG')} · {selectedMenuItem.is_available ? 'Available' : 'Unavailable'}</p></div>
                </div>
              ) : null}
            </article>
          ) : null}
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
                   if (media.revokePreview) URL.revokeObjectURL(media.previewUrl)
                   setMedia(null)
                }}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/80"
                aria-label="Remove selected media"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {viewerRole === 'vendor' && mode === 'post' ? (
            <label className="mt-5 block text-sm font-semibold text-white/75">
              Menu item
              <select value={selectedMenuItemId} onChange={(event) => setSelectedMenuItemId(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-white/10 bg-[#151820] px-3 text-white outline-none focus:border-[#F5A623]">
                <option value="">Link storefront only</option>
                {menuItems.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.is_available}>{item.name}{item.is_available ? '' : ' - unavailable'}</option>
                ))}
              </select>
              <span className="mt-2 block text-xs font-normal text-white/40">Only your own available menu items can show an Order action. Every vendor post still links to your storefront.</span>
            </label>
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
                  if (media?.revokePreview && media.previewUrl) URL.revokeObjectURL(media.previewUrl)
                  setMedia(null)
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                <Type size={16} aria-hidden="true" />
                Text
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {viewerRole === 'vendor' && mode === 'post' && !editPostId ? (
                <button type="button" onClick={() => void submit('draft')} disabled={!canSubmit || busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 px-4 text-sm font-semibold text-white/75 disabled:opacity-45">
                  <Save size={16} aria-hidden="true" /> Save draft
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void submit('publish')}
                disabled={!canSubmit || busy}
                className="inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-full bg-[#F5A623] px-5 text-sm font-bold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : media?.kind === 'video' ? <Play size={15} aria-hidden="true" /> : null}
                {busy ? 'Sending' : mode === 'story' ? 'Share story' : editPostId ? 'Update' : 'Publish'}
              </button>
            </div>
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
