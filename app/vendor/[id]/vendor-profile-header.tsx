'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { DefaultAvatar } from '@/components/default-avatar'
import { formatCompactCount } from '@/lib/feed/display'

type VendorProfileHeaderProps = {
  vendorId: string
  shopName: string
  handle: string | null
  category: string | null
  logoUrl: string | null
  verified: boolean
  status: 'OPEN' | 'BUSY' | 'CLOSED'
  isPaused: boolean
  avgRating: number
  totalRatings: number
  followerCount: number
  followingCount?: number | null
  postCount: number
  viewerFollowsVendor: boolean
  vendorProfileId: string | null
}

export function VendorProfileHeader({
  vendorId,
  shopName,
  handle,
  category,
  logoUrl,
  verified,
  status,
  isPaused,
  avgRating,
  totalRatings,
  followerCount,
  followingCount,
  postCount,
  viewerFollowsVendor,
  vendorProfileId,
}: VendorProfileHeaderProps) {
  const [following, setFollowing] = useState(viewerFollowsVendor)
  const [count, setCount] = useState(followerCount)
  const [busy, setBusy] = useState(false)

  async function toggleFollow() {
    if (!vendorProfileId || busy) return
    setBusy(true)
    const next = !following
    setFollowing(next)
    setCount((current) => Math.max(0, current + (next ? 1 : -1)))
    try {
      const res = await fetch(`/api/feed/profiles/${vendorProfileId}/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const data = await res.json().catch(() => ({})) as { followed?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update follow')
      setFollowing(Boolean(data.followed ?? next))
    } catch {
      setFollowing(!next)
      setCount((current) => Math.max(0, current + (next ? -1 : 1)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[#11131a] shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
      <div className="h-24 bg-[radial-gradient(circle_at_20%_20%,rgba(245,166,35,0.24),transparent_36%),linear-gradient(135deg,rgba(245,166,35,0.10),rgba(255,255,255,0.02))]" />
      <div className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="-mt-12 flex items-end gap-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-3xl border-4 border-[#11131a] bg-white/10 shadow-[0_14px_40px_rgba(0,0,0,0.24)]">
                {logoUrl ? (
                  <Image src={logoUrl} alt={shopName} fill sizes="96px" className="object-cover" />
                ) : (
                  <DefaultAvatar />
                )}
              </div>
              <div className="min-w-0 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-[clamp(1.35rem,2.2vw,2rem)] font-black tracking-[-0.04em] text-white">{shopName}</h1>
                  {verified && <Badge color="var(--lx-green)">Verified</Badge>}
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${isPaused || status === 'CLOSED' ? 'border-white/8 bg-white/5 text-slate-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'}`}>
                    {isPaused ? 'Paused' : status.toLowerCase()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  {category ?? 'Food vendor'}
                  {' · '}
                  {handle ? `@${handle}` : 'official profile'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-400 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
              <span className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <strong className="text-white">{formatCompactCount(count)}</strong> followers
              </span>
              {typeof followingCount === 'number' && (
                <span className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                  <strong className="text-white">{formatCompactCount(followingCount)}</strong> following
                </span>
              )}
              <span className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <strong className="text-white">{formatCompactCount(postCount)}</strong> posts
              </span>
              <span className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                <strong className="text-white">{avgRating.toFixed(1)}</strong> rating from {formatCompactCount(totalRatings)}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {vendorProfileId && (
              <button
                type="button"
                onClick={() => void toggleFollow()}
                disabled={busy}
                aria-pressed={following}
                className="min-h-11 w-full rounded-full border border-[#F5A623]/25 bg-[#F5A623]/10 px-4 py-2.5 text-sm font-semibold text-[#F5A623] transition hover:bg-[#F5A623]/15 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {following ? 'Unfollow' : 'Follow'}
              </button>
            )}
            <Link href={`/vendor/${vendorId}#menu`} className="rounded-full border border-white/8 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300">
              View menu
            </Link>
            <Link href={`/vendor/${vendorId}#deals`} className="rounded-full border border-white/8 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300">
              Deals
            </Link>
            <Link href={`/vendor-followers/${vendorId}`} className="rounded-full border border-white/8 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300">
              Followers
            </Link>
            <Link href={`/vendor-following/${vendorId}`} className="rounded-full border border-white/8 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300">
              Following
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
