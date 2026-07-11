'use client'

import { useState } from 'react'

type PostOption = {
  id: string
  caption: string | null
  status: string
  created_at: string
}

type PackageOption = {
  id: string
  package_key: string
  name: string
  description: string | null
  duration_days: number
  budget_kobo: number
  geographic_radius_km: number
  max_uplift: number
}

type Props = {
  posts: PostOption[]
  packages: PackageOption[]
}

function money(kobo: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(kobo / 100)
}

export function BoostCheckoutForm({ posts, packages }: Props) {
  const [postId, setPostId] = useState(posts[0]?.id ?? '')
  const [packageKey, setPackageKey] = useState(packages[0]?.package_key ?? '')
  const [targetCityId, setTargetCityId] = useState('')
  const [targetZoneId, setTargetZoneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startBoost() {
    if (!postId || !packageKey) {
      setError('Pick a post and boost package first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/boosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          post_id: postId,
          boost_package_key: packageKey,
          target_city_id: targetCityId.trim() || null,
          target_zone_id: targetZoneId.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not start boost checkout')
      if (typeof data.authorization_url === 'string') {
        window.location.href = data.authorization_url
        return
      }
      throw new Error('Checkout URL missing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start boost checkout')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Choose post</span>
          <select
            className="lx-field w-full px-3 py-3"
            value={postId}
            onChange={(e) => setPostId(e.target.value)}
          >
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.caption ?? post.id} · {post.status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Boost package</span>
          <select
            className="lx-field w-full px-3 py-3"
            value={packageKey}
            onChange={(e) => setPackageKey(e.target.value)}
          >
            {packages.map((pkg) => (
              <option key={pkg.package_key} value={pkg.package_key}>
                {pkg.name} · {money(pkg.budget_kobo)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Target city or campus</span>
          <input
            className="lx-field w-full px-3 py-3"
            value={targetCityId}
            onChange={(e) => setTargetCityId(e.target.value)}
            placeholder="Optional target city / campus ID"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.16em] text-white/45">Target zone</span>
          <input
            className="lx-field w-full px-3 py-3"
            value={targetZoneId}
            onChange={(e) => setTargetZoneId(e.target.value)}
            placeholder="Optional delivery zone ID"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void startBoost()}
          className="lx-btn-amber px-4 py-3 text-sm disabled:opacity-50"
        >
          {busy ? 'Opening checkout…' : 'Continue to Paystack'}
        </button>
        <p className="text-xs text-white/45 self-center">Boosts activate only after verified payment.</p>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  )
}
