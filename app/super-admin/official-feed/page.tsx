'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogoutButton } from '@/components/logout-button'
import { PageHeader } from '@/components/ui/page-header'

type AreaScope = 'city' | 'zone'

type OfficialAreaSetting = {
  id: string
  city_id: string | null
  zone_id: string | null
  area_scope: AreaScope
  area_label: string
  morning_enabled: boolean
  evening_enabled: boolean
  auto_publish: boolean
  morning_cron: string | null
  evening_cron: string | null
  late_night_start: string | null
  min_popularity_orders: number | null
  price_threshold_kobo: number | null
  max_posts_per_day: number | null
  max_collection_items: number | null
  picks_max_per_day: number | null
  updated_by: string | null
  updated_at: string | null
}

type OfficialFeedMeta = {
  area_scope: AreaScope
  area_id: string
  collection_type: string
  source_type: string
  source_id: string
  generation_reason: string
  selection_metadata: Record<string, unknown> | null
  dedupe_key: string
  content_hash: string
  is_auto_published: boolean
  approved_at: string | null
  approved_by: string | null
  archived_at: string | null
  archived_reason: string | null
}

type OfficialFeedPost = {
  id: string
  body: string
  status: string
  visibility: string | null
  published_at: string | null
  created_at: string
  is_archived: boolean
  archived_at: string | null
  post_menu_items?: Array<{
    id: string
    menu_item_name_snapshot: string
    menu_item_price_kobo_snapshot: number
    menu_item_image_url_snapshot: string | null
    is_primary: boolean
    is_available_snapshot: boolean
  }>
  official_feed_posts?: OfficialFeedMeta[] | OfficialFeedMeta | null
}

type FeedResponse = {
  posts: OfficialFeedPost[]
  settings: OfficialAreaSetting[]
}

type AreaForm = {
  areaScope: AreaScope
  cityId: string
  zoneId: string
  areaLabel: string
  morningEnabled: boolean
  eveningEnabled: boolean
  autoPublish: boolean
  morningCron: string
  eveningCron: string
  lateNightStart: string
  minPopularityOrders: number
  priceThresholdKobo: number
  maxPostsPerDay: number
  maxCollectionItems: number
  picksMaxPerDay: number
}

const emptyAreaForm: AreaForm = {
  areaScope: 'city',
  cityId: '',
  zoneId: '',
  areaLabel: '',
  morningEnabled: true,
  eveningEnabled: true,
  autoPublish: false,
  morningCron: '0 7 * * *',
  eveningCron: '0 19 * * *',
  lateNightStart: '22:00',
  minPopularityOrders: 10,
  priceThresholdKobo: 300000,
  maxPostsPerDay: 2,
  maxCollectionItems: 5,
  picksMaxPerDay: 2,
}

function fmtDate(value: string | null) {
  if (!value) return 'Not set'
  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function oneMeta(meta: OfficialFeedPost['official_feed_posts']) {
  if (Array.isArray(meta)) return meta[0] ?? null
  return meta ?? null
}

function shortBody(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 140)
}

type BriefTemplate = {
  title: string
  hook: string
  bullets: string[]
  cta: string
  audience: string
  tone: string
}

const BRIEF_TEMPLATES: BriefTemplate[] = [
  {
    title: 'Good Morning Uturu ☀️',
    hook: 'Quick picks to start the day strong.',
    bullets: ['Open vendors near you', 'Fast breakfast options', 'New meals worth checking'],
    cta: 'Tap into the feed for the full lineup.',
    audience: 'Morning crowd',
    tone: 'warm',
  },
  {
    title: '10 Meals Under ₦2,500',
    hook: 'Affordable meals that still feel like a win.',
    bullets: ['Budget-friendly plates', 'Fast lunches', 'Popular student favorites'],
    cta: 'Check the cards and save a meal for later.',
    audience: 'Budget shoppers',
    tone: 'practical',
  },
  {
    title: 'Rainy Day Picks',
    hook: 'Comfort food for when the weather slows everything down.',
    bullets: ['Hot meals', 'Delivery-friendly vendors', 'Cozy late-afternoon options'],
    cta: 'Open the feed and pick your comfort meal.',
    audience: 'Rainy day crowd',
    tone: 'calm',
  },
]

export default function SuperAdminOfficialFeedPage() {
  const router = useRouter()
  const [data, setData] = useState<FeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editSubtitle, setEditSubtitle] = useState('')
  const [editReason, setEditReason] = useState('')
  const [briefTitle, setBriefTitle] = useState('')
  const [briefHook, setBriefHook] = useState('')
  const [briefBullets, setBriefBullets] = useState('Open vendors near you\nFast breakfast options')
  const [briefCta, setBriefCta] = useState('Open the feed to see more.')
  const [briefAudience, setBriefAudience] = useState('Campus community')
  const [briefTone, setBriefTone] = useState('calm')
  const [briefBusy, setBriefBusy] = useState(false)
  const [editingSettingId, setEditingSettingId] = useState<string | null>(null)
  const [areaForm, setAreaForm] = useState<AreaForm>(emptyAreaForm)

  const showToast = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(''), 3000)
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/official-feed', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) {
        router.push('/auth')
        return
      }
      if (!res.ok) {
        setError('Could not load feed data.')
        return
      }
      const json = await res.json() as FeedResponse
      setData(json)
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  const counts = useMemo(() => {
    const posts = data?.posts ?? []
    return {
      total: posts.length,
      published: posts.filter((post) => post.status === 'published').length,
      draft: posts.filter((post) => post.status === 'draft').length,
      archived: posts.filter((post) => post.is_archived || post.status === 'archived').length,
    }
  }, [data])

  const posts = useMemo(() => data?.posts ?? [], [data])
  const draftPosts = useMemo(() => posts.filter((post) => post.status !== 'published' && !post.is_archived), [posts])
  const livePosts = useMemo(() => posts.filter((post) => post.status === 'published' && !post.is_archived), [posts])
  const archivedPosts = useMemo(() => posts.filter((post) => post.is_archived || post.status === 'archived'), [posts])
  const [postFilter, setPostFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all')
  const visiblePosts = useMemo(() => {
    if (postFilter === 'draft') return draftPosts
    if (postFilter === 'published') return livePosts
    if (postFilter === 'archived') return archivedPosts
    return posts
  }, [archivedPosts, draftPosts, livePosts, posts, postFilter])
  const activePostId = selectedPostId ?? editingPostId ?? posts[0]?.id ?? null
  const selectedPost = useMemo(
    () => posts.find((post) => post.id === activePostId) ?? null,
    [activePostId, posts],
  )

  function startEditPost(post: OfficialFeedPost) {
    const meta = oneMeta(post.official_feed_posts)
    setEditingSettingId(null)
    setEditingPostId(post.id)
    setSelectedPostId(post.id)
    setEditTitle(String(meta?.selection_metadata?.title ?? '').trim())
    setEditSubtitle(shortBody(post.body))
    setEditReason(meta?.generation_reason ?? '')
    setError('')
  }

  function startEditSetting(setting: OfficialAreaSetting) {
    setEditingPostId(null)
    setEditingSettingId(setting.id)
    setAreaForm({
      areaScope: setting.area_scope,
      cityId: setting.city_id ?? '',
      zoneId: setting.zone_id ?? '',
      areaLabel: setting.area_label,
      morningEnabled: setting.morning_enabled,
      eveningEnabled: setting.evening_enabled,
      autoPublish: setting.auto_publish,
      morningCron: setting.morning_cron ?? '0 7 * * *',
      eveningCron: setting.evening_cron ?? '0 19 * * *',
      lateNightStart: setting.late_night_start ?? '22:00',
      minPopularityOrders: setting.min_popularity_orders ?? 10,
      priceThresholdKobo: setting.price_threshold_kobo ?? 300000,
      maxPostsPerDay: setting.max_posts_per_day ?? 2,
      maxCollectionItems: setting.max_collection_items ?? 5,
      picksMaxPerDay: setting.picks_max_per_day ?? 2,
    })
    setError('')
  }

  function applyBriefTemplate(template: BriefTemplate) {
    setBriefTitle(template.title)
    setBriefHook(template.hook)
    setBriefBullets(template.bullets.join('\n'))
    setBriefCta(template.cta)
    setBriefAudience(template.audience)
    setBriefTone(template.tone)
  }

  async function createBrief(publish = false) {
    const title = briefTitle.trim()
    const hook = briefHook.trim()
    const bullets = briefBullets
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
    if (!title || !hook) {
      setError('Add a title and a hook first.')
      return
    }

    setBriefBusy(true)
    setError('')
    try {
      const res = await fetch('/api/super-admin/official-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          briefTitle: title,
          briefHook: hook,
          briefBullets: bullets,
          briefCta: briefCta.trim(),
          briefAudience: briefAudience.trim(),
          briefTone: briefTone.trim(),
          publish,
        }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; postId?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not create brief post.')
        return
      }
      showToast(publish ? 'Brief published' : 'Brief saved as draft')
      setEditingPostId(null)
      setSelectedPostId(json.postId ?? null)
      await load()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBriefBusy(false)
    }
  }

  async function saveSetting() {
    if (!areaForm.areaLabel.trim()) {
      setError('Give the area a label first.')
      return
    }
    if (areaForm.areaScope === 'city' && !areaForm.cityId.trim()) {
      setError('Pick a city id for city-scoped rules.')
      return
    }
    if (areaForm.areaScope === 'zone' && !areaForm.zoneId.trim()) {
      setError('Pick a zone id for zone-scoped rules.')
      return
    }

    setBusy('setting')
    setError('')
    try {
      const res = await fetch('/api/super-admin/official-feed', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          areaScope: areaForm.areaScope,
          cityId: areaForm.areaScope === 'city' ? areaForm.cityId.trim() : null,
          zoneId: areaForm.areaScope === 'zone' ? areaForm.zoneId.trim() : null,
          areaLabel: areaForm.areaLabel.trim(),
          morningEnabled: areaForm.morningEnabled,
          eveningEnabled: areaForm.eveningEnabled,
          autoPublish: areaForm.autoPublish,
          morningCron: areaForm.morningCron.trim(),
          eveningCron: areaForm.eveningCron.trim(),
          lateNightStart: areaForm.lateNightStart.trim(),
          minPopularityOrders: areaForm.minPopularityOrders,
          priceThresholdKobo: areaForm.priceThresholdKobo,
          maxPostsPerDay: areaForm.maxPostsPerDay,
          maxCollectionItems: areaForm.maxCollectionItems,
          picksMaxPerDay: areaForm.picksMaxPerDay,
        }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not save area settings.')
        return
      }
      setEditingSettingId(null)
      setAreaForm(emptyAreaForm)
      showToast('Area settings saved')
      await load()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function postAction(action: 'publish' | 'archive' | 'reject' | 'edit', postId: string) {
    setBusy(postId + action)
    setError('')
    try {
      const payload: Record<string, unknown> = { action, postId }
      if (action === 'edit') {
        payload.title = editTitle.trim() || undefined
        payload.subtitle = editSubtitle.trim() || undefined
        payload.generationReason = editReason.trim() || undefined
      }
      const res = await fetch('/api/super-admin/official-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not update post.')
        return
      }
      if (action === 'edit') {
        setEditingPostId(null)
        showToast('Post updated')
      } else if (action === 'publish') {
        showToast('Post published')
      } else if (action === 'archive') {
        showToast('Post archived')
      } else {
        showToast('Post rejected')
      }
      await load()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="lx-page flex items-center justify-center">
        <div className="w-full max-w-4xl space-y-3 px-4">
          <div className="lx-skeleton h-16 rounded-2xl" />
          <div className="grid gap-3 md:grid-cols-3">
            {[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-24 rounded-2xl" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="lx-page lx-console overflow-hidden px-5 py-10"
      style={{
        backgroundColor: '#050507',
        backgroundImage: 'radial-gradient(120% 80% at 50% -12%, rgba(245,166,35,0.10), transparent 50%)',
      }}
    >
      {toast && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#F5A623] px-4 py-2 text-sm font-medium text-black shadow-lg">
          {toast}
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-5xl lx-enter">
        <PageHeader
          title="Official Feed"
          subtitle="Publish, edit, or archive the generated feed posts that power the public feed. For a normal post, jump into the regular composer."
          badge="Super Admin"
          actions={
            <div className="flex items-center gap-2">
              <Link
                href="/feed-v2"
                className="rounded-full bg-[#171a22] px-4 py-2 text-xs font-semibold text-white/80 transition hover:bg-[#1d212b]"
              >
                Create post
              </Link>
              <LogoutButton />
            </div>
          }
        />

        <section className="mt-5 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-[#101116] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/40">Create brief</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Draft a post</h2>
                </div>
                <BadgeText on>{briefBusy ? 'Working' : 'Ready'}</BadgeText>
              </div>

              <div className="mt-4 space-y-3">
                <Field label="Title" value={briefTitle} onChange={setBriefTitle} />
                <Field label="Hook" value={briefHook} onChange={setBriefHook} />
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.16em] text-white/40">Bullets</span>
                  <textarea
                    value={briefBullets}
                    onChange={(e) => setBriefBullets(e.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-2xl border border-white/8 bg-[#0e1117] px-3 py-3 text-sm text-white outline-none"
                  />
                </label>
                <Field label="CTA" value={briefCta} onChange={setBriefCta} />
                <Field label="Audience" value={briefAudience} onChange={setBriefAudience} />
                <Field label="Tone" value={briefTone} onChange={setBriefTone} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {BRIEF_TEMPLATES.map((template) => (
                  <button
                    key={template.title}
                    type="button"
                    onClick={() => applyBriefTemplate(template)}
                    className="rounded-full bg-[#171a22] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:bg-[#1d212b]"
                  >
                    {template.title}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void createBrief(false)}
                  disabled={briefBusy}
                  className="rounded-full bg-[#171a22] px-4 py-2 text-sm font-semibold text-white/75 disabled:opacity-50"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={() => void createBrief(true)}
                  disabled={briefBusy}
                  className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  Publish
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-[#101116] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Queue</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPostFilter('all')}
                  className={`rounded-2xl px-3 py-3 text-left ${postFilter === 'all' ? 'bg-[#171a22]' : 'bg-[#101116]'}`}
                >
                  <p className="text-sm font-semibold text-white">{counts.total}</p>
                  <p className="text-xs text-white/45">All</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPostFilter('draft')}
                  className={`rounded-2xl px-3 py-3 text-left ${postFilter === 'draft' ? 'bg-[#171a22]' : 'bg-[#101116]'}`}
                >
                  <p className="text-sm font-semibold text-white">{counts.draft}</p>
                  <p className="text-xs text-white/45">Drafts</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPostFilter('published')}
                  className={`rounded-2xl px-3 py-3 text-left ${postFilter === 'published' ? 'bg-[#171a22]' : 'bg-[#101116]'}`}
                >
                  <p className="text-sm font-semibold text-white">{counts.published}</p>
                  <p className="text-xs text-white/45">Live</p>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPostFilter('archived')}
                className={`mt-2 w-full rounded-2xl px-3 py-3 text-left ${postFilter === 'archived' ? 'bg-[#171a22]' : 'bg-[#101116]'}`}
              >
                <p className="text-sm font-semibold text-white">{counts.archived}</p>
                <p className="text-xs text-white/45">Archived</p>
              </button>
            </div>
          </aside>

          <main className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-[#101116] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/40">Feed posts</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Review generated content</h2>
                </div>
                <p className="text-xs text-white/35">Approve, edit, or archive. This is the content desk.</p>
              </div>
            </div>

            <div className="space-y-3">
              {visiblePosts.length ? visiblePosts.map((post) => {
                const meta = oneMeta(post.official_feed_posts)
                const primaryItem = post.post_menu_items?.find((item) => item.is_primary) ?? post.post_menu_items?.[0] ?? null
                const statusLabel = post.status === 'published' ? 'Published' : post.status === 'draft' ? 'Draft' : post.status
                const active = activePostId === post.id
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedPostId(post.id)}
                    className={`block w-full rounded-2xl px-4 py-4 text-left transition ${active ? 'bg-[#141821] shadow-[0_0_0_1px_rgba(245,166,35,0.18)]' : 'bg-[#101116] hover:bg-[#141821]'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-white">{primaryItem?.menu_item_name_snapshot ?? 'Official feed post'}</p>
                          <BadgeText on={post.status === 'published'}>{statusLabel}</BadgeText>
                          <BadgeText on={Boolean(meta?.is_auto_published)}>{meta?.is_auto_published ? 'Auto' : 'Manual'}</BadgeText>
                        </div>
                        <p className="mt-1 text-xs text-white/40">
                          {fmtDate(post.published_at ?? post.created_at)} · {meta?.collection_type ?? 'unknown collection'}
                        </p>
                        <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-white/75 whitespace-pre-wrap">{post.body}</p>
                      </div>
                    </div>
                  </button>
                )
              }) : (
                <p className="rounded-2xl bg-[#0b0d12] px-4 py-6 text-sm text-white/45">
                  No official feed posts yet. The scheduler or a manual collection run will create them here.
                </p>
              )}
            </div>
          </main>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-[#101116] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/40">Inspector</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Selected post</h2>
                </div>
                <button type="button" onClick={() => { setEditingPostId(null); setSelectedPostId(null); }} className="rounded-full bg-[#171a22] px-3 py-1.5 text-xs font-semibold text-white/75">
                  Reset
                </button>
              </div>

              {selectedPost ? (() => {
                const meta = oneMeta(selectedPost.official_feed_posts)
                const primaryItem = selectedPost.post_menu_items?.find((item) => item.is_primary) ?? selectedPost.post_menu_items?.[0] ?? null
                const isEditing = editingPostId === selectedPost.id
                return (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl bg-[#0b0d12] p-3">
                      <p className="text-sm font-semibold text-white">{primaryItem?.menu_item_name_snapshot ?? 'Official feed post'}</p>
                      <p className="mt-1 text-xs text-white/40">{meta?.collection_type ?? 'unknown collection'} · {fmtDate(selectedPost.published_at ?? selectedPost.created_at)}</p>
                      <p className="mt-2 text-sm text-white/75 whitespace-pre-wrap">{selectedPost.body}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <BadgeText on={selectedPost.is_archived || selectedPost.status === 'archived'}>{selectedPost.is_archived || selectedPost.status === 'archived' ? 'Archived' : 'Live'}</BadgeText>
                      <BadgeText on={meta?.is_auto_published ?? false}>{meta?.is_auto_published ? 'Auto' : 'Manual'}</BadgeText>
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <Field label="Title" value={editTitle} onChange={setEditTitle} />
                        <Field label="Subtitle" value={editSubtitle} onChange={setEditSubtitle} />
                        <Field label="Generation reason" value={editReason} onChange={setEditReason} />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void postAction('edit', selectedPost.id)} disabled={busy === selectedPost.id + 'edit'} className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                            {busy === selectedPost.id + 'edit' ? 'Saving...' : 'Save edit'}
                          </button>
                          <button type="button" onClick={() => setEditingPostId(null)} className="rounded-full bg-[#171a22] px-4 py-2 text-sm font-semibold text-white/75">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <button type="button" onClick={() => startEditPost(selectedPost)} className="rounded-full bg-[#171a22] px-4 py-2 text-sm font-semibold text-white/75">
                          Edit selected
                        </button>
                        <button type="button" onClick={() => void postAction('publish', selectedPost.id)} disabled={busy === selectedPost.id + 'publish'} className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                          {busy === selectedPost.id + 'publish' ? 'Publishing...' : 'Publish'}
                        </button>
                        <button type="button" onClick={() => void postAction('archive', selectedPost.id)} disabled={busy === selectedPost.id + 'archive'} className="rounded-full bg-[#171a22] px-4 py-2 text-sm font-semibold text-white/75 disabled:opacity-50">
                          Archive
                        </button>
                        <button type="button" onClick={() => void postAction('reject', selectedPost.id)} disabled={busy === selectedPost.id + 'reject'} className="rounded-full bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-50">
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )
              })() : (
                <p className="rounded-2xl bg-[#0b0d12] px-4 py-6 text-sm text-white/45">
                  Select a post to inspect it.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/8 bg-[#101116] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/40">Area rules</p>
                  <h3 className="mt-1 text-sm font-semibold text-white">Scheduler inputs</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPostId(null)
                    setEditingSettingId(null)
                    setAreaForm(emptyAreaForm)
                  }}
                  className="rounded-full bg-[#171a22] px-3 py-1.5 text-xs font-semibold text-white/75"
                >
                  New rule
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {data?.settings.slice(0, 3).map((setting) => (
                  <button
                    key={setting.id}
                    type="button"
                    onClick={() => startEditSetting(setting)}
                    className="flex w-full items-center justify-between rounded-2xl bg-[#0b0d12] px-3 py-2 text-left"
                  >
                    <span className="text-sm text-white">{setting.area_label}</span>
                    <BadgeText on={setting.auto_publish}>{setting.auto_publish ? 'Auto' : 'Manual'}</BadgeText>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>

        {editingSettingId && (
          <section className="mt-5 rounded-2xl border border-white/8 bg-[#101116] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Rule editor</p>
                <h2 className="mt-1 text-lg font-semibold text-white">Edit scheduler rule</h2>
              </div>
              <button type="button" onClick={() => setEditingSettingId(null)} className="rounded-full bg-[#171a22] px-3 py-1.5 text-xs font-semibold text-white/75">
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Area label" value={areaForm.areaLabel} onChange={(value) => setAreaForm((prev) => ({ ...prev, areaLabel: value }))} />
              <SelectField
                label="Scope"
                value={areaForm.areaScope}
                options={[['city', 'City'], ['zone', 'Zone']]}
                onChange={(value) => setAreaForm((prev) => ({ ...prev, areaScope: value as AreaScope }))}
              />
              <Field label="City id" value={areaForm.cityId} onChange={(value) => setAreaForm((prev) => ({ ...prev, cityId: value }))} />
              <Field label="Zone id" value={areaForm.zoneId} onChange={(value) => setAreaForm((prev) => ({ ...prev, zoneId: value }))} />
              <Field label="Morning cron" value={areaForm.morningCron} onChange={(value) => setAreaForm((prev) => ({ ...prev, morningCron: value }))} />
              <Field label="Evening cron" value={areaForm.eveningCron} onChange={(value) => setAreaForm((prev) => ({ ...prev, eveningCron: value }))} />
              <Field label="Late night start" value={areaForm.lateNightStart} onChange={(value) => setAreaForm((prev) => ({ ...prev, lateNightStart: value }))} />
              <Field label="Min popularity orders" value={String(areaForm.minPopularityOrders)} onChange={(value) => setAreaForm((prev) => ({ ...prev, minPopularityOrders: Number(value) || 0 }))} />
              <Field label="Price threshold kobo" value={String(areaForm.priceThresholdKobo)} onChange={(value) => setAreaForm((prev) => ({ ...prev, priceThresholdKobo: Number(value) || 0 }))} />
              <Field label="Max posts/day" value={String(areaForm.maxPostsPerDay)} onChange={(value) => setAreaForm((prev) => ({ ...prev, maxPostsPerDay: Number(value) || 1 }))} />
              <Field label="Max collection items" value={String(areaForm.maxCollectionItems)} onChange={(value) => setAreaForm((prev) => ({ ...prev, maxCollectionItems: Number(value) || 1 }))} />
              <Field label="Picks/day" value={String(areaForm.picksMaxPerDay)} onChange={(value) => setAreaForm((prev) => ({ ...prev, picksMaxPerDay: Number(value) || 1 }))} />
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <ToggleChip label="Morning" value={areaForm.morningEnabled} onChange={(value) => setAreaForm((prev) => ({ ...prev, morningEnabled: value }))} />
                <ToggleChip label="Evening" value={areaForm.eveningEnabled} onChange={(value) => setAreaForm((prev) => ({ ...prev, eveningEnabled: value }))} />
                <ToggleChip label="Auto publish" value={areaForm.autoPublish} onChange={(value) => setAreaForm((prev) => ({ ...prev, autoPublish: value }))} />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void saveSetting()} disabled={busy === 'setting'} className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                {busy === 'setting' ? 'Saving...' : 'Save rule'}
              </button>
                <button type="button" onClick={() => setEditingSettingId(null)} className="rounded-full bg-[#171a22] px-4 py-2 text-sm font-semibold text-white/75">
                Close
              </button>
            </div>
          </section>
        )}

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.16em] text-white/40">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-2xl border border-white/8 bg-[#0e1117] px-3 py-3 text-sm text-white outline-none"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.16em] text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-2xl border border-white/8 bg-[#0e1117] px-3 py-3 text-sm text-white outline-none"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function ToggleChip({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="rounded-full bg-[#171a22] px-4 py-2 text-sm font-semibold text-white/75 shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
      style={{ color: value ? '#F5A623' : 'rgba(255,255,255,0.75)', boxShadow: value ? '0 0 0 1px rgba(245,166,35,0.18), 0 6px 16px rgba(245,166,35,0.10)' : '0 1px 2px rgba(0,0,0,0.12)' }}
    >
      {label}: {value ? 'On' : 'Off'}
    </button>
  )
}

function BadgeText({ on, children }: { on: boolean; children: string }) {
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.10)]"
      style={{
        background: on ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.05)',
        color: on ? '#F5A623' : 'rgba(255,255,255,0.7)',
      }}
    >
      {children}
    </span>
  )
}





