'use client'

import { useCallback, useEffect, useState } from 'react'

type GeneratedPost = { id: string; body: string; automatic_post_type: string; generated_at: string; status: string }

export default function VendorFeedAutomationPage() {
  const [enabled, setEnabled] = useState(true)
  const [posts, setPosts] = useState<GeneratedPost[]>([])
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const response = await fetch('/api/vendor/feed-automation')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Could not load generated posts')
    setEnabled(data.settings.optional_marketing_enabled !== false)
    setPosts(data.posts ?? [])
  }, [])
  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Load failed')) }, [load])
  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/vendor/feed-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    setNotice(response.ok ? 'Saved' : data.error ?? 'Action failed')
    if (response.ok) await load()
  }
  return <main className="p-5 text-white">
    <h1 className="text-2xl font-bold">Feed automation</h1>
    <p className="mt-2 text-sm text-white/55">Manual posting remains available. Generated posts are labelled and always based on real store activity.</p>
    {notice && <p className="mt-4 rounded-xl bg-white/10 p-3 text-sm">{notice}</p>}
    <section className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-5">
      <div><h2 className="font-semibold">Optional marketing posts</h2><p className="text-xs text-white/45">Turn off new-item, stock, price, popularity, and milestone marketing.</p></div>
      <button onClick={() => void post({ action: 'settings', optionalMarketingEnabled: !enabled })} className={`rounded-full px-4 py-2 text-sm font-semibold ${enabled ? 'bg-[#F5A623] text-black' : 'bg-white/10'}`}>{enabled ? 'Enabled' : 'Disabled'}</button>
    </section>
    <section className="mt-6 space-y-3">
      <h2 className="font-semibold">Generated posts</h2>
      {posts.length ? posts.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-wide text-[#F5A623]">{item.automatic_post_type} · {item.status}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p>
        {item.status !== 'archived' && <button onClick={() => void post({ action: 'archive', postId: item.id })} className="mt-3 text-xs text-red-300">Archive generated post</button>}
      </article>) : <p className="text-sm text-white/45">No generated posts yet.</p>}
    </section>
  </main>
}
