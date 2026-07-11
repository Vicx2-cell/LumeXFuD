'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { InfoCard } from '@/components/ui/info-card'
import { EmptyState } from '@/components/ui/empty-state'
import type { FeedTabKey, RankedFeedCandidate } from '@/lib/feed/types'

const FEED_EVENT_SESSION_KEY = 'lumex.feed.session'
const FEED_IMPRESSION_SEEN_KEY = 'lumex.feed.impressions.seen'

function hashString(value: string) {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return Math.abs(hash).toString(36)
}

function getClientFeedSessionId() {
  if (typeof window === 'undefined') return 'server'
  const existing = window.localStorage.getItem(FEED_EVENT_SESSION_KEY)
  if (existing) return existing
  const next = window.crypto?.randomUUID?.() ?? `feed-${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.localStorage.setItem(FEED_EVENT_SESSION_KEY, next)
  return next
}

function getSeenImpressionKeys() {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.sessionStorage.getItem(FEED_IMPRESSION_SEEN_KEY)
    if (!raw) return new Set<string>()
    const values = JSON.parse(raw) as string[]
    return new Set(values)
  } catch {
    return new Set<string>()
  }
}

function persistSeenImpressionKeys(keys: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(FEED_IMPRESSION_SEEN_KEY, JSON.stringify(Array.from(keys)))
  } catch {
    // ignore storage failures
  }
}

async function sendFeedEventBatch(batch: {
  batch_key: string
  source_tab: FeedTabKey
  events: Array<{
    event_key: string
    post_id?: string
    event_type: string
    source_tab?: FeedTabKey
    amount_kobo?: number
    metadata?: Record<string, unknown>
  }>
}) {
  const body = JSON.stringify(batch)
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon('/api/feed/events', blob)) return
  }
  await fetch('/api/feed/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
}

type MenuItem = {
  id: string
  name: string
  price_kobo: number
  is_available: boolean
}

type ComposerMedia = {
  file: File
  fileName: string
  kind: 'image' | 'video'
  progress: number
  status: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
  storage_path?: string
  public_url?: string
  mime_type?: string
  duration_seconds?: number
  width?: number | null
  height?: number | null
  previewUrl: string
}

type ComposerMenuSelection = {
  menu_item_id: string
  is_primary: boolean
  order_label?: string
}

async function getVideoDuration(file: File): Promise<number | undefined> {
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(video.duration) ? Math.round(video.duration) : undefined)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(undefined)
    }
  })
}

function uploadFeedMedia(file: File, mediaKind: 'image' | 'video', onProgress: (progress: number) => void): Promise<{
  storage_path: string
  public_url: string
  mime_type: string
  duration_seconds: number | null
  width: number | null
  height: number | null
}> {
  return new Promise(async (resolve, reject) => {
    const meta: Record<string, unknown> = { media_kind: mediaKind }
    if (mediaKind === 'video') {
      meta.duration_seconds = await getVideoDuration(file)
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/feed/uploads')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => {
      const payload = xhr.response as {
        storage_path?: string
        public_url?: string
        mime_type?: string
        duration_seconds?: number | null
        width?: number | null
        height?: number | null
        error?: string
      } | null
      if (xhr.status < 200 || xhr.status >= 300 || !payload?.storage_path || !payload.public_url || !payload.mime_type) {
        reject(new Error(payload?.error ?? 'Upload failed'))
        return
      }
      resolve({
        storage_path: payload.storage_path,
        public_url: payload.public_url,
        mime_type: payload.mime_type,
        duration_seconds: payload.duration_seconds ?? null,
        width: payload.width ?? null,
        height: payload.height ?? null,
      })
    }
    xhr.onerror = () => reject(new Error('Upload failed'))

    const form = new FormData()
    form.append('file', file)
    form.append('meta', JSON.stringify(meta))
    xhr.send(form)
  })
}

export function FeedClient({
  tab,
  tabs,
  items,
  sessionRole,
  menuItems = [],
  nextCursor = null,
  hasMore = false,
}: {
  tab: FeedTabKey
  tabs: Record<FeedTabKey, boolean>
  items: RankedFeedCandidate[]
  sessionRole: string
  menuItems?: MenuItem[]
  nextCursor?: string | null
  hasMore?: boolean
}) {
  const router = useRouter()
  const [selectedTab, setSelectedTab] = useState<FeedTabKey>(tab)
  const [feedItems, setFeedItems] = useState<RankedFeedCandidate[]>(items)
  const [pageCursor, setPageCursor] = useState<string | null>(nextCursor)
  const [canLoadMore, setCanLoadMore] = useState<boolean>(hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [body, setBody] = useState('')
  const [contentWarning, setContentWarning] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'followers' | 'private' | 'unlisted'>('public')
  const [audienceScope, setAudienceScope] = useState<'all' | 'customers' | 'vendors' | 'riders' | 'staff'>('all')
  const [locationText, setLocationText] = useState('')
  const [campusId, setCampusId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [mentions, setMentions] = useState('')
  const [postKind, setPostKind] = useState<'TEXT' | 'IMAGE' | 'VIDEO' | 'TIKTOK' | 'MENU_ITEM' | 'PROMOTION'>('TEXT')
  const [menuSelection, setMenuSelection] = useState<ComposerMenuSelection[]>([])
  const [promoTitle, setPromoTitle] = useState('')
  const [promoDescription, setPromoDescription] = useState('')
  const [promoPrice, setPromoPrice] = useState('')
  const [promoUrl, setPromoUrl] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [media, setMedia] = useState<ComposerMedia[]>([])
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)

  useEffect(() => {
    setSelectedTab(tab)
  }, [tab])

  useEffect(() => {
    setFeedItems(items)
    setPageCursor(nextCursor)
    setCanLoadMore(hasMore)
  }, [items, nextCursor, hasMore])

  const selectedMenuItems = useMemo(() => {
    const map = new Map(menuItems.map((item) => [item.id, item]))
    return menuSelection.map((item) => ({ ...item, menu: map.get(item.menu_item_id) }))
  }, [menuItems, menuSelection])

  const attachedPreview = useMemo(() => media.filter((m) => m.status === 'done'), [media])
  const feedSessionId = useMemo(() => getClientFeedSessionId(), [])
  const roleHeadline = sessionRole === 'vendor'
    ? 'Vendor studio: post updates, attach items, and turn attention into orders.'
    : sessionRole === 'rider'
      ? 'Rider pulse: spot busy areas, monitor orders, and watch what is moving.'
      : 'Customer feed: discover meals, creators, deals, and vendors in one place.'

  function patchFeedItem(id: string, updater: (item: RankedFeedCandidate) => RankedFeedCandidate) {
    setFeedItems((current) => current.map((item) => item.id === id ? updater(item) : item))
  }

  async function submitJson(url: string, payload: Record<string, unknown>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json() as Record<string, unknown> & { error?: string; ok?: boolean }
    if (!res.ok) throw new Error(data.error ?? 'Request failed')
    return data
  }

  function trackFeedAction(item: RankedFeedCandidate, eventType: string, metadata: Record<string, unknown> = {}) {
    const batchKey = `act:${feedSessionId}:${selectedTab}:${hashString(`${eventType}:${item.id}:${JSON.stringify(metadata)}`)}`
    void sendFeedEventBatch({
      batch_key: batchKey,
      source_tab: selectedTab,
      events: [{
        event_key: `${eventType}:${item.id}:${batchKey}`,
        post_id: item.id,
        event_type: eventType,
        source_tab: selectedTab,
        metadata: {
          ...metadata,
          session_id: feedSessionId,
        },
      }],
    }).catch(() => {})
  }

  function setMenuPrimary(id: string) {
    setMenuSelection((current) => current.map((item) => ({ ...item, is_primary: item.menu_item_id === id })))
  }

  useEffect(() => {
    if (feedItems.length === 0) return
    const seen = getSeenImpressionKeys()
    const eligible = feedItems
      .slice(0, 20)
      .filter((item) => !seen.has(`${selectedTab}:${item.id}`))
      .map((item, index) => ({
        item,
        key: `${selectedTab}:${item.id}`,
        position: index,
      }))
    if (eligible.length === 0) return

    for (const { key } of eligible) {
      seen.add(key)
    }
    persistSeenImpressionKeys(seen)

    const batchSeed = eligible.map(({ item }) => item.id).join('|')
    const batchKey = `impr:${feedSessionId}:${selectedTab}:${hashString(batchSeed)}`
    void sendFeedEventBatch({
      batch_key: batchKey,
      source_tab: selectedTab,
      events: eligible.map(({ item, position }) => ({
        event_key: `impression:${item.id}:${position}:${batchKey}`,
        post_id: item.id,
        event_type: 'impression',
        source_tab: selectedTab,
        metadata: {
          position,
          score: item.score,
          session_id: feedSessionId,
        },
      })),
    }).catch(() => {})
  }, [feedItems, feedSessionId, selectedTab])

  function toggleMenuItem(id: string) {
    setMenuSelection((current) => {
      const exists = current.find((item) => item.menu_item_id === id)
      if (exists) return current.filter((item) => item.menu_item_id !== id)
      return [...current, { menu_item_id: id, is_primary: current.length === 0 }]
    })
  }

  async function addFiles(files: FileList | File[]) {
    setStatus('')
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('video/') ? 'video' : 'image'
      const previewUrl = URL.createObjectURL(file)
      const entry: ComposerMedia = {
        file,
        fileName: file.name,
        kind,
        progress: 0,
        status: 'queued',
        previewUrl,
      }
      setMedia((current) => [...current, entry])

      try {
        setMedia((current) => current.map((item) => item.file === file ? { ...item, status: 'uploading', progress: 1 } : item))
        const uploaded = await uploadFeedMedia(file, kind, (progress) => {
          setMedia((current) => current.map((item) => item.file === file ? { ...item, progress, status: 'uploading' } : item))
        })
        setMedia((current) => current.map((item) => item.file === file ? {
          ...item,
          status: 'done',
          progress: 100,
          storage_path: uploaded.storage_path,
          public_url: uploaded.public_url,
          mime_type: uploaded.mime_type,
          duration_seconds: uploaded.duration_seconds ?? undefined,
          width: uploaded.width,
          height: uploaded.height,
        } : item))
      } catch (error) {
        setMedia((current) => current.map((item) => item.file === file ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' } : item))
      }
    }
  }

  async function retryUpload(index: number) {
    const entry = media[index]
    if (!entry) return
    setMedia((current) => current.map((item, i) => i === index ? { ...item, status: 'uploading', progress: 1, error: undefined } : item))
    try {
      const uploaded = await uploadFeedMedia(entry.file, entry.kind, (progress) => {
        setMedia((current) => current.map((item, i) => i === index ? { ...item, progress, status: 'uploading' } : item))
      })
      setMedia((current) => current.map((item, i) => i === index ? {
        ...item,
        status: 'done',
        progress: 100,
        storage_path: uploaded.storage_path,
        public_url: uploaded.public_url,
        mime_type: uploaded.mime_type,
        duration_seconds: uploaded.duration_seconds ?? undefined,
        width: uploaded.width,
        height: uploaded.height,
      } : item))
    } catch (error) {
      setMedia((current) => current.map((item, i) => i === index ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' } : item))
    }
  }

  async function submit(mode: 'draft' | 'publish') {
    if (saving) return
    if (media.some((m) => m.status === 'uploading')) {
      setStatus('Wait for uploads to finish.')
      return
    }
    if (media.some((m) => m.status === 'error')) {
      setStatus('Fix failed uploads before continuing.')
      return
    }

    const payload = {
      draft_id: draftId ?? undefined,
      mode,
      body: body.trim() || undefined,
      content_warning: contentWarning.trim() || undefined,
      visibility,
      audience_scope: audienceScope,
      post_kind: postKind,
      campus_id: campusId || undefined,
      zone_id: zoneId || undefined,
      location_text: locationText.trim() || undefined,
      hashtags: hashtags.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean),
      mentions: mentions.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean),
      media: media.filter((m) => m.status === 'done').map((m, index) => ({
        kind: m.kind,
        storage_path: m.storage_path,
        public_url: m.public_url,
        mime_type: m.mime_type,
        duration_seconds: m.duration_seconds,
        width: m.width ?? undefined,
        height: m.height ?? undefined,
        alt_text: m.fileName,
        caption: m.fileName,
        sort_order: index,
        is_primary: index === 0,
      })),
      menu_items: menuSelection.map((item, index) => ({
        menu_item_id: item.menu_item_id,
        is_primary: index === 0 || item.is_primary,
        order_label: item.order_label,
      })),
      promotion: postKind === 'PROMOTION' ? {
        title: promoTitle.trim(),
        description: promoDescription.trim() || undefined,
        campaign_price_kobo: Number.parseInt(promoPrice, 10) * 100,
        landing_url: promoUrl.trim() || undefined,
      } : undefined,
    }

    setSaving(true)
    setStatus(mode === 'draft' ? 'Saving draft...' : 'Publishing...')
    try {
      const res = await fetch(mode === 'draft' ? '/api/feed/drafts' : '/api/feed/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as { ok?: boolean; postId?: string; error?: string }
      if (!res.ok || !data.ok || !data.postId) {
        setStatus(data.error ?? 'Could not save post')
        return
      }
      setDraftId(data.postId)
      setStatus(mode === 'draft' ? 'Draft saved.' : 'Post published.')
      if (mode === 'publish') {
        setBody('')
        setContentWarning('')
        setLocationText('')
        setCampusId('')
        setZoneId('')
        setHashtags('')
        setMentions('')
        setPromoTitle('')
        setPromoDescription('')
        setPromoPrice('')
        setPromoUrl('')
        setMenuSelection([])
        setMedia([])
        setDraftId(null)
        router.refresh()
      }
    } catch {
      setStatus('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function runOptimisticAction(
    item: RankedFeedCandidate,
    optimistic: (post: RankedFeedCandidate) => RankedFeedCandidate,
    request: () => Promise<Record<string, unknown>>,
    finalize: (post: RankedFeedCandidate, data: Record<string, unknown>) => RankedFeedCandidate,
    errorMessage: string,
  ) {
    const before = feedItems
    patchFeedItem(item.id, optimistic)
    try {
      const data = await request()
      patchFeedItem(item.id, (post) => finalize(post, data))
    } catch (error) {
      setFeedItems(before)
      setStatus(error instanceof Error ? error.message : errorMessage)
    }
  }

  async function handleLike(item: RankedFeedCandidate) {
    const nextLiked = !item.viewerHasLiked
    await runOptimisticAction(
      item,
      (post) => ({
        ...post,
        viewerHasLiked: nextLiked,
        likeCount: Math.max(0, (post.likeCount ?? 0) + (nextLiked ? 1 : -1)),
      }),
      async () => submitJson(`/api/feed/posts/${item.id}/like`, { enabled: nextLiked }) as Promise<Record<string, unknown>>,
      (post, data) => ({
        ...post,
        viewerHasLiked: Boolean(data.liked ?? nextLiked),
        likeCount: typeof data.likeCount === 'number' ? data.likeCount : post.likeCount,
      }),
      'Could not update like',
    )
    trackFeedAction(item, nextLiked ? 'like' : 'unlike')
  }

  async function handleBookmark(item: RankedFeedCandidate) {
    const nextSaved = !item.viewerHasBookmarked
    await runOptimisticAction(
      item,
      (post) => ({
        ...post,
        viewerHasBookmarked: nextSaved,
        saveCount: Math.max(0, (post.saveCount ?? 0) + (nextSaved ? 1 : -1)),
      }),
      async () => submitJson(`/api/feed/posts/${item.id}/bookmark`, { enabled: nextSaved }) as Promise<Record<string, unknown>>,
      (post, data) => ({
        ...post,
        viewerHasBookmarked: Boolean(data.bookmarked ?? nextSaved),
        saveCount: typeof data.saveCount === 'number' ? data.saveCount : post.saveCount,
      }),
      'Could not update bookmark',
    )
    trackFeedAction(item, 'save', { saved: nextSaved })
  }

  async function handleRepost(item: RankedFeedCandidate) {
    const nextReposted = !item.viewerHasReposted
    await runOptimisticAction(
      item,
      (post) => ({
        ...post,
        viewerHasReposted: nextReposted,
        repostCount: Math.max(0, (post.repostCount ?? 0) + (nextReposted ? 1 : -1)),
      }),
      async () => submitJson(`/api/feed/posts/${item.id}/repost`, { enabled: nextReposted }) as Promise<Record<string, unknown>>,
      (post, data) => ({
        ...post,
        viewerHasReposted: Boolean(data.reposted ?? nextReposted),
        repostCount: typeof data.repostCount === 'number' ? data.repostCount : post.repostCount,
      }),
      'Could not update repost',
    )
    trackFeedAction(item, 'repost', { reposted: nextReposted })
  }

  async function handleFollow(item: RankedFeedCandidate) {
    const nextFollowed = !item.viewerFollowsAuthor
    await runOptimisticAction(
      item,
      (post) => ({
        ...post,
        viewerFollowsAuthor: nextFollowed,
      }),
      async () => submitJson(`/api/feed/profiles/${item.authorProfileId}/follow`, { enabled: nextFollowed }) as Promise<Record<string, unknown>>,
      (post, data) => ({
        ...post,
        viewerFollowsAuthor: Boolean(data.followed ?? nextFollowed),
      }),
      'Could not update follow',
    )
    trackFeedAction(item, 'follow', { followed: nextFollowed })
  }

  async function handleReply(item: RankedFeedCandidate) {
    const text = window.prompt('Write your reply')
    if (!text?.trim()) return
    const before = feedItems
    try {
      const data = await submitJson(`/api/feed/posts/${item.id}/reply`, { body: text.trim() })
      patchFeedItem(item.id, (post) => ({
        ...post,
        replyCount: typeof data.replyCount === 'number' ? data.replyCount : post.replyCount,
      }))
      trackFeedAction(item, 'reply', { reply_length: text.trim().length })
    } catch (error) {
      setFeedItems(before)
      setStatus(error instanceof Error ? error.message : 'Could not create reply')
    }
  }

  async function handleQuote(item: RankedFeedCandidate) {
    const text = window.prompt('Write your quote post')
    if (text == null) return
    const before = feedItems
    try {
      await submitJson(`/api/feed/posts/${item.id}/quote`, { body: text.trim() })
      trackFeedAction(item, 'repost', { quote: true, quote_length: text.trim().length })
      setStatus('Quote posted.')
    } catch (error) {
      setFeedItems(before)
      setStatus(error instanceof Error ? error.message : 'Could not create quote')
    }
  }

  async function handleReport(item: RankedFeedCandidate) {
    const reason = window.prompt('Report reason')
    if (!reason?.trim()) return
    try {
      await submitJson(`/api/feed/posts/${item.id}/report`, {
        report_type: 'other',
        reason: reason.trim(),
      })
      trackFeedAction(item, 'report', { report_type: 'other' })
      setStatus('Report sent.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not report post')
    }
  }

  async function handleFeedback(item: RankedFeedCandidate, kind: 'not_interested' | 'hide_creator') {
    const before = feedItems
    patchFeedItem(item.id, (post) => (kind === 'hide_creator' ? { ...post, viewerMutedAuthor: true } : post))
    try {
      await submitJson(`/api/feed/posts/${item.id}/feedback`, { kind })
      trackFeedAction(item, kind, { kind })
      if (kind === 'hide_creator') {
        setFeedItems((current) => current.filter((post) => post.authorProfileId !== item.authorProfileId))
      }
      if (kind === 'not_interested') {
        setFeedItems((current) => current.filter((post) => post.id !== item.id))
      }
      setStatus(kind === 'hide_creator' ? 'Creator hidden.' : 'Marked not interested.')
    } catch (error) {
      setFeedItems(before)
      setStatus(error instanceof Error ? error.message : 'Could not update feedback')
    }
  }

  async function handleMute(item: RankedFeedCandidate) {
    const before = feedItems
    try {
      await submitJson(`/api/feed/profiles/${item.authorProfileId}/mute`, { enabled: !item.viewerMutedAuthor })
      if (!item.viewerMutedAuthor) {
        trackFeedAction(item, 'hide_creator', { kind: 'mute' })
      }
      if (!item.viewerMutedAuthor) {
        setFeedItems((current) => current.filter((post) => post.authorProfileId !== item.authorProfileId))
      } else {
        setFeedItems(before)
        router.refresh()
      }
      setStatus(item.viewerMutedAuthor ? 'Creator unmuted.' : 'Creator muted.')
    } catch (error) {
      setFeedItems(before)
      setStatus(error instanceof Error ? error.message : 'Could not update mute')
    }
  }

  async function handleBlock(item: RankedFeedCandidate) {
    const before = feedItems
    try {
      await submitJson(`/api/feed/profiles/${item.authorProfileId}/block`, { enabled: !item.viewerBlockedAuthor })
      if (!item.viewerBlockedAuthor) {
        trackFeedAction(item, 'block')
      }
      if (!item.viewerBlockedAuthor) {
        setFeedItems((current) => current.filter((post) => post.authorProfileId !== item.authorProfileId))
      } else {
        setFeedItems(before)
        router.refresh()
      }
      setStatus(item.viewerBlockedAuthor ? 'Creator unblocked.' : 'Creator blocked.')
    } catch (error) {
      setFeedItems(before)
      setStatus(error instanceof Error ? error.message : 'Could not update block')
    }
  }

  async function handleShare(item: RankedFeedCandidate) {
    const url = `${window.location.origin}/feed#${item.id}`
    const title = item.authorDisplayName ?? item.authorHandle ?? 'LumeX Feed post'
    if (navigator.share) {
      try {
        await navigator.share({ title, text: 'Check this out on LumeX Feed', url })
        trackFeedAction(item, 'share', { channel: 'share_sheet' })
        return
      } catch {
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      trackFeedAction(item, 'share', { channel: 'clipboard' })
      setStatus('Link copied.')
    } catch {
      trackFeedAction(item, 'share', { channel: 'fallback' })
      setStatus(url)
    }
  }

  async function loadMore() {
    if (!pageCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/feed?tab=${selectedTab}&cursor=${encodeURIComponent(pageCursor)}&limit=20`)
      const data = await res.json() as {
        items?: RankedFeedCandidate[]
        nextCursor?: string | null
        hasMore?: boolean
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not load more')
      const incoming = data.items ?? []
      setFeedItems((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...incoming.filter((item) => !seen.has(item.id))]
      })
      setPageCursor(data.nextCursor ?? null)
      setCanLoadMore(Boolean(data.hasMore))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load more')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section className="space-y-4">
      <InfoCard tone="amber-strong" className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(tabs) as FeedTabKey[]).map((key) => (
              <button
                key={key}
                type="button"
                disabled={!tabs[key]}
                onClick={() => {
                  setSelectedTab(key)
                  router.push(`/feed?tab=${key}`)
                }}
                className="rounded-full px-3 py-1.5 text-xs font-medium transition"
                style={{
                  background: selectedTab === key ? 'rgba(245,166,35,0.16)' : 'rgba(255,255,255,0.04)',
                  border: selectedTab === key ? '1px solid rgba(245,166,35,0.48)' : '1px solid rgba(255,255,255,0.08)',
                  color: tabs[key] ? (selectedTab === key ? '#F5A623' : 'rgba(255,255,255,0.7)') : 'rgba(255,255,255,0.28)',
                }}
              >
                {key.replaceAll('_', ' ')}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Role view</p>
                <p className="mt-1 text-sm text-white/75">{roleHeadline}</p>
              </div>
              <Badge color="rgba(255,255,255,0.35)">{selectedTab.replaceAll('_', ' ')}</Badge>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">Composer</p>
              <h2 className="text-lg font-semibold text-white">
                {sessionRole === 'vendor' ? 'What are you promoting today?' : sessionRole === 'rider' ? 'What should riders notice?' : 'What are you sharing?'}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => router.refresh()} className="lx-btn-secondary px-3 py-2 text-xs">
                Refresh
              </button>
              <Badge color="var(--lx-green)">Role: {sessionRole}</Badge>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-white/45">Current feed</p>
                <p className="text-sm text-white/70">{items.length} ranked items in the {selectedTab.replaceAll('_', ' ')} tab</p>
              </div>
              <Badge color="var(--lx-green)">Ranked</Badge>
            </div>
            {items.length > 0 && (
              <div className="mt-3 space-y-2">
                {items.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-3 py-2 text-xs text-white/65">
                    <span>{item.postKind} · {item.visibility}</span>
                    <span>{item.score.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.16em] text-white/45">Post type</span>
              <select value={postKind} onChange={(e) => setPostKind(e.target.value as typeof postKind)} className="lx-field mt-1 w-full px-3 py-2.5">
                <option value="TEXT">Text</option>
                <option value="IMAGE">Image</option>
                <option value="VIDEO">Video</option>
                <option value="MENU_ITEM">Menu item</option>
                <option value="PROMOTION">Promotion</option>
                <option value="TIKTOK">TikTok</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.16em] text-white/45">Visibility</span>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="lx-field mt-1 w-full px-3 py-2.5">
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.16em] text-white/45">Audience scope</span>
            <select value={audienceScope} onChange={(e) => setAudienceScope(e.target.value as typeof audienceScope)} className="lx-field mt-1 w-full px-3 py-2.5">
              <option value="all">All audiences</option>
              <option value="customers">Customers</option>
              <option value="vendors">Vendors</option>
              <option value="riders">Riders</option>
              <option value="staff">Staff</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.16em] text-white/45">Body</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="Tell students what is new, what is hot, or what is on the menu." />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.16em] text-white/45">Content warning</span>
            <input value={contentWarning} onChange={(e) => setContentWarning(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="Spicy, spoiler, etc." />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.16em] text-white/45">Campus</span>
              <input value={campusId} onChange={(e) => setCampusId(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="Optional campus ID" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.16em] text-white/45">Zone</span>
              <input value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="Optional zone ID" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.16em] text-white/45">Location</span>
            <input value={locationText} onChange={(e) => setLocationText(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="Campus, hostel, or store location" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.16em] text-white/45">Hashtags</span>
              <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="#jollof #campusfood" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.16em] text-white/45">Mentions</span>
              <input value={mentions} onChange={(e) => setMentions(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="@vendor @rider" />
            </label>
          </div>

          {sessionRole === 'vendor' && (
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-white/45">Attach menu items</p>
                <div className="mt-2 grid gap-2">
                  {menuItems.length === 0 ? (
                    <EmptyState bare title="No menu items yet" description="Add items in your vendor dashboard to attach them to feed posts." />
                  ) : (
                    menuItems.map((item) => {
                      const selected = menuSelection.some((sel) => sel.menu_item_id === item.id)
                      const primary = menuSelection.find((sel) => sel.menu_item_id === item.id)?.is_primary ?? false
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleMenuItem(item.id)}
                          className="rounded-2xl border px-3 py-3 text-left"
                          style={{ borderColor: selected ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.08)', background: selected ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.03)' }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{item.name}</p>
                              <p className="text-xs text-white/45">{item.is_available ? 'Available now' : 'Currently unavailable'}</p>
                            </div>
                            <Badge color={item.is_available ? 'var(--lx-green)' : 'var(--lx-red)'}>{`₦${Math.round(item.price_kobo / 100).toLocaleString('en-NG')}`}</Badge>
                          </div>
                          {selected && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-white/60">
                              <span>{primary ? 'Primary attachment' : 'Attached'}</span>
                              {!primary && (
                                <button type="button" onClick={(e) => { e.stopPropagation(); setMenuPrimary(item.id) }} className="text-amber-300">Make primary</button>
                              )}
                            </div>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {postKind === 'PROMOTION' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Campaign title</span>
                <input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Campaign price (₦)</span>
                <input value={promoPrice} onChange={(e) => setPromoPrice(e.target.value.replace(/[^0-9]/g, ''))} className="lx-field mt-1 w-full px-3 py-2.5" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Promotion description</span>
                <textarea value={promoDescription} onChange={(e) => setPromoDescription(e.target.value)} rows={2} className="lx-field mt-1 w-full px-3 py-2.5" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs uppercase tracking-[0.16em] text-white/45">Landing URL</span>
                <input value={promoUrl} onChange={(e) => setPromoUrl(e.target.value)} className="lx-field mt-1 w-full px-3 py-2.5" placeholder="https://..." />
              </label>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.16em] text-white/45">Media</p>
              <button type="button" onClick={() => document.getElementById('feed-media-picker')?.click()} className="text-sm text-amber-300">Add files</button>
            </div>
            <input
              id="feed-media-picker"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
              multiple
              className="hidden"
              onChange={(e) => { const files = e.target.files; if (files && files.length > 0) void addFiles(files) }}
            />
            {media.length === 0 ? (
              <EmptyState bare title="No media attached" description="Attach images or videos to make the post more engaging." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {media.map((item, index) => (
                  <div key={`${item.fileName}-${index}`} className="rounded-2xl border border-white/8 bg-white/4 p-3">
                    <div className="aspect-[4/3] overflow-hidden rounded-xl bg-black/30">
                      {item.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.previewUrl} alt={item.fileName} className="h-full w-full object-cover" />
                      ) : (
                        <video src={item.previewUrl} className="h-full w-full object-cover" controls muted />
                      )}
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-white">{item.fileName}</p>
                        <Badge color={item.status === 'done' ? 'var(--lx-green)' : item.status === 'error' ? 'var(--lx-red)' : 'var(--lx-amber)'}>{item.status}</Badge>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-amber-400" style={{ width: `${item.progress}%` }} />
                      </div>
                      {item.error ? (
                        <button type="button" onClick={() => void retryUpload(index)} className="text-xs text-amber-300">Retry upload</button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-white/45">Preview</p>
            <div className="mt-3 space-y-3">
              <p className="whitespace-pre-wrap text-sm text-white/80">{body.trim() || 'Your post preview will appear here.'}</p>
              <div className="flex flex-wrap gap-2">
                {selectedMenuItems.map((item) => (
                  <Badge key={item.menu_item_id} color={item.menu?.is_available ? 'var(--lx-green)' : 'var(--lx-red)'}>
                    {item.menu?.name ?? item.menu_item_id}
                  </Badge>
                ))}
                {postKind === 'PROMOTION' && promoTitle.trim() && <Badge color="var(--lx-amber)">{promoTitle}</Badge>}
                {attachedPreview.length > 0 && <Badge color="var(--lx-green)">{attachedPreview.length} media attached</Badge>}
              </div>
            </div>
          </div>

          {status && <p className="text-sm text-white/55">{status}</p>}

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void submit('draft')} disabled={saving} className="lx-btn-secondary px-4 py-3">
              Save draft
            </button>
            <button type="button" onClick={() => void submit('publish')} disabled={saving} className="lx-btn-amber px-4 py-3">
              Publish post
            </button>
          </div>
        </div>
      </InfoCard>

      {feedItems.length === 0 ? (
        <EmptyState
          title="No feed items yet"
          description="The feed foundation is live. Once posts arrive, likes, follows, reposts, reports, and saves will appear here."
          action={<a href="/vendor-dashboard" className="lx-btn-amber">Go to vendor dashboard</a>}
        />
      ) : (
        <div className="space-y-4">
          {feedItems.map((item) => (
            <article key={item.id} id={item.id} className="lx-surface p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{item.authorDisplayName ?? item.authorHandle ?? `Post ${item.id.slice(0, 8)}`}</p>
                  <p className="text-xs text-white/45 mt-0.5">
                    {item.postKind} · {item.visibility} · {item.status}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {item.isSponsored && <Badge color="var(--lx-amber)">Sponsored</Badge>}
                  <Badge color="var(--lx-green)">{item.score.toFixed(3)}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-white/55 sm:grid-cols-4">
                <span>Likes: {item.likeCount ?? 0}</span>
                <span>Replies: {item.replyCount ?? 0}</span>
                <span>Reposts: {item.repostCount ?? 0}</span>
                <span>Saves: {item.saveCount ?? 0}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleLike(item)} className="lx-btn-secondary px-3 py-2 text-xs">
                  {item.viewerHasLiked ? 'Unlike' : 'Like'}
                </button>
                <button type="button" onClick={() => void handleReply(item)} className="lx-btn-secondary px-3 py-2 text-xs">
                  Reply
                </button>
                <button type="button" onClick={() => void handleRepost(item)} className="lx-btn-secondary px-3 py-2 text-xs">
                  {item.viewerHasReposted ? 'Undo repost' : 'Repost'}
                </button>
                <button type="button" onClick={() => void handleBookmark(item)} className="lx-btn-secondary px-3 py-2 text-xs">
                  {item.viewerHasBookmarked ? 'Saved' : 'Save'}
                </button>
                <button type="button" onClick={() => void handleFollow(item)} className="lx-btn-secondary px-3 py-2 text-xs">
                  {item.viewerFollowsAuthor ? 'Following' : 'Follow'}
                </button>
                <button type="button" onClick={() => void handleShare(item)} className="lx-btn-secondary px-3 py-2 text-xs">
                  Share
                </button>
                <button
                  type="button"
                  onClick={() => {
                    trackFeedAction(item, 'menu_click', { open: openMenuFor !== item.id })
                    setOpenMenuFor((current) => current === item.id ? null : item.id)
                  }}
                  className="lx-btn-secondary px-3 py-2 text-xs"
                >
                  More
                </button>
              </div>

              {openMenuFor === item.id && (
                <div className="grid gap-2 rounded-2xl border border-white/8 bg-black/25 p-3 sm:grid-cols-2">
                  <button type="button" onClick={() => { setOpenMenuFor(null); void handleQuote(item) }} className="rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-white/70">
                    Quote post
                  </button>
                  <button type="button" onClick={() => { setOpenMenuFor(null); void handleReport(item) }} className="rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-white/70">
                    Report post
                  </button>
                  <button type="button" onClick={() => { setOpenMenuFor(null); void handleFeedback(item, 'not_interested') }} className="rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-white/70">
                    Not interested
                  </button>
                  <button type="button" onClick={() => { setOpenMenuFor(null); void handleFeedback(item, 'hide_creator') }} className="rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-white/70">
                    Hide creator
                  </button>
                  <button type="button" onClick={() => { setOpenMenuFor(null); void handleMute(item) }} className="rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-white/70">
                    {item.viewerMutedAuthor ? 'Unmute creator' : 'Mute creator'}
                  </button>
                  <button type="button" onClick={() => { setOpenMenuFor(null); void handleBlock(item) }} className="rounded-xl border border-white/10 px-3 py-2 text-left text-xs text-white/70">
                    {item.viewerBlockedAuthor ? 'Unblock creator' : 'Block creator'}
                  </button>
                </div>
              )}
            </article>
          ))}
          {canLoadMore && (
            <div className="flex justify-center">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="lx-btn-secondary px-4 py-3">
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
