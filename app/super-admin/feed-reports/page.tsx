'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'

type ReportRow = {
  id: string
  post_id: string
  reporter_profile_id: string
  report_type: string
  reason: string
  status: string
  resolution: string | null
  assigned_to: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  reporter: {
    display_name: string | null
    handle: string | null
    avatar_url: string | null
  } | null
  post: {
    id: string
    body: string | null
    status: string | null
    isArchived: boolean | null
    deletedAt: string | null
    author: {
      display_name: string | null
      handle: string | null
      avatar_url: string | null
    } | null
    viewCount: number
    likeCount: number
    replyCount: number
    repostCount: number
    saveCount: number
    shareCount: number
    image: string | null
    mediaKind: string | null
  } | null
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

export default function SuperAdminFeedReportsPage() {
  const router = useRouter()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/super-admin/feed-reports', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) {
        router.push('/auth')
        return
      }
      const json = await res.json().catch(() => ({})) as { reports?: ReportRow[]; error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not load feed reports.')
        return
      }
      setReports(json.reports ?? [])
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  async function moderate(reportId: string, action: 'archive' | 'dismiss') {
    setBusy(`${reportId}:${action}`)
    setError('')
    try {
      const res = await fetch('/api/super-admin/feed-reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, action }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not update report.')
        return
      }
      setReports((current) => current.filter((report) => report.id !== reportId))
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="lx-page lx-console px-5 py-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Feed Reports"
          subtitle="Review bad posts, remove harmful content, or dismiss false alarms."
          badge="Super Admin"
        />

        {error ? <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}

        {loading ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="lx-skeleton h-96 rounded-3xl" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <p className="mt-6 rounded-3xl border border-white/8 bg-[#101116] px-5 py-8 text-sm text-white/55">
            No content reports at the moment.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {reports.map((report) => (
              <article key={report.id} className="overflow-hidden rounded-3xl border border-white/8 bg-[#101116] shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/35">{report.report_type.replace(/_/g, ' ')}</p>
                    <p className="text-sm text-white/55">{fmtDate(report.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-white/8 px-3 py-1 text-xs font-semibold text-white/65">
                    {report.status}
                  </span>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-2xl border border-white/8 bg-black">
                    {report.post?.image ? (
                      <div className="relative aspect-[4/5]">
                        <Image src={report.post.image} alt="" fill sizes="(max-width: 768px) 100vw, 220px" className="object-cover" />
                      </div>
                    ) : (
                      <div className="grid aspect-[4/5] place-items-center px-4 text-center text-sm text-white/40">
                        No media attached
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {report.post?.author?.display_name ?? 'Unknown author'}
                      </p>
                      <p className="text-xs text-white/40">
                        @{report.post?.author?.handle ?? 'unknown'} - {report.post?.viewCount ?? 0} views - {report.post?.likeCount ?? 0} likes
                      </p>
                    </div>

                    <p className="text-sm leading-6 text-white/72">
                      {report.post?.body ?? 'No post text available.'}
                    </p>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-white/35">Report reason</p>
                      <p className="mt-1 text-sm text-white/75">{report.reason}</p>
                      {report.resolution ? (
                        <p className="mt-3 text-xs text-white/40">
                          Resolution: {report.resolution}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void moderate(report.id, 'dismiss')}
                        disabled={busy !== null}
                        className="rounded-full bg-white/6 px-4 py-2 text-sm font-semibold text-white/75 disabled:opacity-50"
                      >
                        {busy === `${report.id}:dismiss` ? 'Dismissing...' : 'Dismiss'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void moderate(report.id, 'archive')}
                        disabled={busy !== null}
                        className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                      >
                        {busy === `${report.id}:archive` ? 'Removing...' : 'Remove post'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
