'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

type StateTab = 'active' | 'drafts' | 'archived' | 'processing' | 'failed'

type Item = {
  id: string
  caption: string | null
  post_kind: string
  status: string
  is_archived: boolean
  deleted_at: string | null
  archived_at: string | null
  published_at: string | null
  created_at: string
  view_count: number
  order_count: number
  storage_bytes: number
  related_menu_item_id: string | null
  post_media: Array<{
    public_url: string | null
    provider_type: string
    storage_bytes: number
    media_kind: string
  }>
}

type Quota = {
  activeCount: number
  draftCount: number
  archivedCount: number
  processingCount: number
  failedCount: number
  storageBytes: number
  limit: number
  remaining: number | null
  canPublish: boolean
  premiumActive: boolean
}

type Suggestion = {
  postId: string
  reason: string
  evidence: Record<string, unknown>
  expectedQuotaRecovered: number
}

type PremiumStatus = {
  premiumEnabled: boolean
  premiumUIVisible: boolean
  premiumFallbackPolicy: string
  hasPremium: boolean
  subscriptionState: string
  renewalOrExpiryAt: string | null
  entitlements: Record<string, boolean | number | string | null>
  benefits: Record<string, boolean>
}

const TABS: StateTab[] = ['active', 'drafts', 'archived', 'processing', 'failed']

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(value: string | null) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function VideosClient() {
  const [tab, setTab] = useState<StateTab>('active')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [premium, setPremium] = useState<PremiumStatus | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [performanceItem, setPerformanceItem] = useState<Item | null>(null)

  const load = useCallback(async (state: StateTab) => {
    setLoading(true)
    setError('')
    try {
      const [quotaRes, listRes, staleRes, premiumRes] = await Promise.all([
        fetch('/api/feed/video-quota'),
        fetch(`/api/feed/videos?state=${state}&limit=100`),
        fetch('/api/feed/stale-suggestions'),
        fetch('/api/premium/status'),
      ])
      const quotaData = await quotaRes.json().catch(() => ({}))
      const listData = await listRes.json().catch(() => ({}))
      const staleData = await staleRes.json().catch(() => ({}))
      const premiumData = await premiumRes.json().catch(() => ({}))
      if (!quotaRes.ok) throw new Error(quotaData.error ?? 'Could not load quota')
      if (!listRes.ok) throw new Error(listData.error ?? 'Could not load videos')
      setQuota({ ...(quotaData.quota ?? {}), ...(listData.quota ?? {}) })
      setItems(listData.items ?? [])
      setSuggestions(staleData.suggestions ?? [])
      setPremium(premiumData.status ?? premiumData ?? null)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load videos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(tab)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load, tab])

  const quotaWarning = useMemo(() => {
    if (!quota || !Number.isFinite(quota.limit) || quota.limit <= 0) return null
    const pct = quota.activeCount / quota.limit
    if (pct >= 1) return '100%'
    if (pct >= 0.9) return '90%'
    if (pct >= 0.8) return '80%'
    return null
  }, [quota])

  async function mutate(url: string, method = 'POST', body?: unknown) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Action failed')
      await load(tab)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const bulkAction = async (action: 'archive' | 'restore' | 'delete') => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (action === 'delete' && !window.confirm(`Delete ${ids.length} videos? This is a soft delete with cleanup.`)) return
    const url = action === 'archive'
      ? '/api/feed/posts/bulk-archive'
      : action === 'restore'
        ? '/api/feed/posts/bulk-restore'
        : '/api/feed/posts/bulk-delete'
    await mutate(url, 'POST', action === 'delete' ? { post_ids: ids, confirm: true } : { post_ids: ids })
  }

  const dismissSuggestion = (postId: string) => {
    setSuggestions((prev) => prev.filter((item) => item.postId !== postId))
  }

  return (
    <div className="lx-page lx-console pb-28 overflow-hidden">
      <div className="mx-auto max-w-5xl px-4 py-4 space-y-4">
        <div className="lx-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">Video management</p>
              <h1 className="text-2xl font-semibold text-white">Videos and lifecycle</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color="var(--lx-green)">Active videos: {quota ? `${quota.activeCount} / ${Number.isFinite(quota.limit) ? quota.limit : 'Unlimited'}` : '...'}</Badge>
              {quota?.storageBytes != null && <Badge color="var(--lx-amber)">Storage used: {fmtBytes(quota.storageBytes)}</Badge>}
              {quota?.premiumActive && <Badge color="var(--lx-green)">Premium active</Badge>}
            </div>
          </div>
          {quotaWarning && <p className="mt-3 text-sm text-amber-300">Quota warning: {quotaWarning} used.</p>}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">TikTok connection</p>
              <p className="mt-1 text-sm text-white">{premium?.benefits?.tiktok_connection ? 'Available' : 'Locked'}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Advanced analytics</p>
              <p className="mt-1 text-sm text-white">{premium?.benefits?.analytics ? 'Available' : 'Locked'}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Scheduling / pinning</p>
              <p className="mt-1 text-sm text-white">
                {(premium?.benefits?.scheduling ? 'Scheduling available' : 'Scheduling locked') + ' · ' + (premium?.benefits?.pinning ? 'Pinning available' : 'Pinning locked')}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Multiple menu tags</p>
              <p className="mt-1 text-sm text-white">{premium?.entitlements?.['premium.menu.multiple_tags'] ? 'Available' : 'Locked'}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Premium badge</p>
              <p className="mt-1 text-sm text-white">{premium?.benefits?.badge ? 'Shown' : 'Hidden'}</p>
            </div>
            <div className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-wide text-white/40">Boost discount</p>
              <p className="mt-1 text-sm text-white">
                {typeof premium?.entitlements?.['premium.boost.discount_percent'] === 'number'
                  ? `${premium.entitlements['premium.boost.discount_percent']}%`
                  : 'Locked'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((state) => (
            <button
              key={state}
              className="lx-btn-secondary px-3 py-2 text-xs"
              onClick={() => setTab(state)}
              style={{ borderColor: tab === state ? 'rgba(245,166,35,0.45)' : undefined }}
            >
              {state}
            </button>
          ))}
        </div>

        {suggestions.length > 0 && (
          <section className="lx-surface p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Archive suggestions</p>
                <p className="text-xs text-white/45">These are suggestions only. Nothing auto-archives.</p>
              </div>
              <Badge color="var(--lx-amber)">{suggestions.length}</Badge>
            </div>
            <div className="space-y-2">
              {suggestions.slice(0, 5).map((suggestion) => (
                <div key={suggestion.postId} className="rounded-2xl border border-white/8 p-3 bg-white/[0.03]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{suggestion.reason}</p>
                      <p className="text-xs text-white/45 mt-1">Expected quota recovered: {suggestion.expectedQuotaRecovered}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="lx-btn-secondary px-3 py-2 text-xs"
                        disabled={busy}
                        onClick={() => void mutate(`/api/feed/posts/${suggestion.postId}/archive`, 'POST', { reason: 'Stale content suggestion' })}
                      >
                        Archive
                      </button>
                      <button
                        className="lx-btn-secondary px-3 py-2 text-xs"
                        onClick={() => dismissSuggestion(suggestion.postId)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy || selected.size === 0} onClick={() => void bulkAction('archive')}>Bulk archive</button>
          <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy || selected.size === 0} onClick={() => void bulkAction('restore')}>Bulk restore</button>
          <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy || selected.size === 0} onClick={() => void bulkAction('delete')}>Bulk delete</button>
          <button className="lx-btn-secondary px-3 py-2 text-xs" onClick={() => void load(tab)}>Refresh</button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <div key={n} className="h-28 rounded-2xl lx-skeleton" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={`No ${tab} videos`} description="Video lifecycle items will appear here." />
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const thumb = item.post_media[0]?.public_url ?? null
              return (
                <article key={item.id} className="lx-surface p-3 flex gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select video ${item.id}`}
                    checked={selected.has(item.id)}
                    onChange={(e) => setSelected((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(item.id)
                      else next.delete(item.id)
                      return next
                    })}
                  />
                  <div className="h-20 w-20 overflow-hidden rounded-xl bg-white/5 shrink-0">
                    {thumb ? (
                      // Public feed URLs are intentionally rendered as plain image tags here.
                      // The page only lists already-generated thumbnails and does not need
                      // Next.js remote image optimization for the management surface.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-xs text-white/30">No media</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">{item.caption ?? item.post_kind}</p>
                        <p className="text-xs text-white/45">{item.post_kind} · {item.status} · {item.is_archived ? 'Archived' : 'Visible'}</p>
                      </div>
                      <Badge color="var(--lx-green)">{item.view_count} views</Badge>
                    </div>
                    <p className="mt-2 text-xs text-white/45">
                      Orders: {item.order_count} · Storage: {fmtBytes(item.storage_bytes ?? 0)} · Created: {fmtDate(item.created_at)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy} onClick={() => void mutate(`/api/feed/posts/${item.id}/archive`, 'POST', { reason: 'Archive from manager' })}>Archive</button>
                      <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy} onClick={() => void mutate(`/api/feed/posts/${item.id}/restore`, 'POST')}>Restore</button>
                      <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy} onClick={() => { if (window.confirm('Delete this post?')) void mutate(`/api/feed/posts/${item.id}`, 'DELETE', { reason: 'Deleted from manager' }) }}>Delete</button>
                      {item.status === 'failed' && (
                        <button className="lx-btn-secondary px-3 py-2 text-xs" disabled={busy} onClick={() => void mutate(`/api/feed/posts/${item.id}/retry-processing`, 'POST')}>
                          Retry failed processing
                        </button>
                      )}
                      <button className="lx-btn-secondary px-3 py-2 text-xs" onClick={() => setPerformanceItem(item)}>View performance</button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {performanceItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Video performance"
          onClick={() => setPerformanceItem(null)}
        >
          <div className="lx-surface w-full max-w-lg p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Performance</p>
                <h2 className="text-lg font-semibold text-white truncate">{performanceItem.caption ?? performanceItem.post_kind}</h2>
              </div>
              <button className="lx-btn-secondary px-3 py-2 text-xs" onClick={() => setPerformanceItem(null)}>Close</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/8 p-3">
                <p className="text-white/45 text-xs uppercase">Views</p>
                <p className="text-white text-lg font-semibold">{performanceItem.view_count}</p>
              </div>
              <div className="rounded-2xl border border-white/8 p-3">
                <p className="text-white/45 text-xs uppercase">Attributed orders</p>
                <p className="text-white text-lg font-semibold">{performanceItem.order_count}</p>
              </div>
              <div className="rounded-2xl border border-white/8 p-3 col-span-2">
                <p className="text-white/45 text-xs uppercase">Lifecycle</p>
                <p className="text-white text-sm">{performanceItem.status} · {performanceItem.is_archived ? 'Archived' : 'Active'} · {fmtDate(performanceItem.published_at)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
