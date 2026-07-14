'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'

type PendingStory = {
  id: string
  author_profile_id: string
  media_url: string
  media_kind: 'image' | 'video'
  caption: string | null
  status: string
  created_at: string
  expires_at: string
  profile: {
    display_name: string | null
    handle: string | null
    avatar_url: string | null
    profile_kind: string | null
  } | null
}

export default function SuperAdminFeedStoriesPage() {
  const router = useRouter()
  const [stories, setStories] = useState<PendingStory[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/super-admin/feed-stories', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) {
        router.push('/auth')
        return
      }
      const json = await res.json().catch(() => ({})) as { stories?: PendingStory[]; error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not load pending stories.')
        return
      }
      setStories(json.stories ?? [])
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

  async function moderate(storyId: string, action: 'approve' | 'reject') {
    setBusy(`${storyId}:${action}`)
    setError('')
    try {
      const res = await fetch('/api/super-admin/feed-stories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, action }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not update story.')
        return
      }
      setStories((current) => current.filter((story) => story.id !== storyId))
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="lx-page lx-console px-5 py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Story Approvals"
          subtitle="Review student stories before they appear in the public feed."
          badge="Super Admin"
        />

        {error ? <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((item) => <div key={item} className="lx-skeleton h-80 rounded-3xl" />)}
          </div>
        ) : stories.length === 0 ? (
          <p className="mt-6 rounded-3xl border border-white/8 bg-[#101116] px-5 py-8 text-sm text-white/55">
            No pending student stories right now.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {stories.map((story) => (
              <article key={story.id} className="overflow-hidden rounded-3xl border border-white/8 bg-[#101116] shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                <div className="relative aspect-[9/14] bg-black">
                  <Image src={story.media_url} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{story.profile?.display_name ?? 'Student'}</p>
                    <p className="text-xs text-white/40">@{story.profile?.handle ?? 'student'} · expires {new Date(story.expires_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  {story.caption ? <p className="text-sm text-white/70">{story.caption}</p> : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void moderate(story.id, 'reject')}
                      disabled={busy !== null}
                      className="rounded-full bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 disabled:opacity-50"
                    >
                      {busy === `${story.id}:reject` ? 'Rejecting...' : 'Reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void moderate(story.id, 'approve')}
                      disabled={busy !== null}
                      className="rounded-full bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      {busy === `${story.id}:approve` ? 'Approving...' : 'Approve'}
                    </button>
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
