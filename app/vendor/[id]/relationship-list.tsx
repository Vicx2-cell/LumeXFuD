import Link from 'next/link'
import { DefaultAvatar } from '@/components/default-avatar'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'

type Direction = 'followers' | 'following'

function titleFor(direction: Direction) {
  return direction === 'followers' ? 'Followers' : 'Following'
}

export async function RelationshipList({
  vendorId,
  direction,
  searchParams,
}: {
  vendorId: string
  direction: Direction
  searchParams?: Promise<{ q?: string; cursor?: string }>
}) {
  const search = ((await (searchParams ?? Promise.resolve({})).catch(() => ({}))) as { q?: string; cursor?: string })
  const db = createSupabaseAdmin()
  const session = await getCurrentUser()

  const { data: vendorProfile } = await db
    .from('social_profiles')
    .select('id, handle, display_name, avatar_url, is_private')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  const vendorProfileId = (vendorProfile as { id?: string } | null)?.id ?? null
  if (!vendorProfileId) {
    return <p className="text-sm text-slate-400">No social profile found for this vendor yet.</p>
  }

  const viewerProfile = session
    ? session.role === 'vendor'
      ? await db.from('social_profiles').select('id').eq('vendor_id', session.userId ?? '').maybeSingle()
      : session.role === 'customer'
        ? await db.from('social_profiles').select('id').eq('customer_id', session.userId ?? '').maybeSingle()
        : session.role === 'rider'
          ? await db.from('social_profiles').select('id').eq('rider_id', session.userId ?? '').maybeSingle()
          : await db.from('social_profiles').select('id').or(`customer_id.eq.${session.userId ?? ''},admin_id.eq.${session.userId ?? ''}`).maybeSingle()
    : { data: null }
  const viewerProfileId = viewerProfile.data?.id ? String(viewerProfile.data.id) : null

  const limit = 20
  let relationQuery = db
    .from('follows')
    .select('created_at, follower_profile_id, followed_profile_id')
    .order('created_at', { ascending: false })
    .limit(limit)
  relationQuery = direction === 'followers'
    ? relationQuery.eq('followed_profile_id', vendorProfileId)
    : relationQuery.eq('follower_profile_id', vendorProfileId)
  if (search.cursor) relationQuery = relationQuery.lt('created_at', search.cursor)

  const { data: relationRows } = await relationQuery
  const profileIds = (relationRows ?? []).map((row) => String(direction === 'followers' ? (row as { follower_profile_id: string }).follower_profile_id : (row as { followed_profile_id: string }).followed_profile_id))
  const { data: profiles } = profileIds.length > 0
    ? await db
      .from('social_profiles')
      .select('id, handle, display_name, avatar_url, is_private, is_verified, official_badge_kind, profile_kind')
      .in('id', profileIds)
    : { data: [] }

  const blockedIds = new Set<string>()
  if (viewerProfileId && profileIds.length > 0) {
    const [outgoing, incoming] = await Promise.all([
      db.from('blocks').select('blocked_profile_id').eq('blocker_profile_id', viewerProfileId).in('blocked_profile_id', profileIds),
      db.from('blocks').select('blocker_profile_id').eq('blocked_profile_id', viewerProfileId).in('blocker_profile_id', profileIds),
    ])
    for (const row of outgoing.data ?? []) blockedIds.add(String((row as { blocked_profile_id: string }).blocked_profile_id))
    for (const row of incoming.data ?? []) blockedIds.add(String((row as { blocker_profile_id: string }).blocker_profile_id))
  }

  const profileById = new Map((profiles ?? []).map((row) => [String((row as { id: string }).id), row as {
    id: string
    handle: string | null
    display_name: string | null
    avatar_url: string | null
    is_private: boolean | null
    is_verified: boolean | null
    official_badge_kind: string | null
    profile_kind: string | null
  }]))
  const rows = (relationRows ?? [])
    .map((row) => {
      const profileId = String(direction === 'followers' ? (row as { follower_profile_id: string }).follower_profile_id : (row as { followed_profile_id: string }).followed_profile_id)
      const profile = profileById.get(profileId)
      return profile ? { profile, createdAt: String((row as { created_at: string }).created_at) } : null
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => !row.profile.is_private)
    .filter((row) => !blockedIds.has(row.profile.id))
    .filter((row) => {
      const q = (search.q ?? '').trim().toLowerCase()
      if (!q) return true
      return String(row.profile.display_name ?? '').toLowerCase().includes(q) || String(row.profile.handle ?? '').toLowerCase().includes(q)
    })

  const nextCursor = relationRows && relationRows.length === limit ? String(relationRows[relationRows.length - 1]?.created_at ?? '') : null

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{titleFor(direction)}</p>
          <h1 className="mt-1 text-2xl font-black text-white">{titleFor(direction)}</h1>
        </div>
        <Link href={`/vendor/${vendorId}`} className="rounded-full border border-white/8 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-300">
          Back to vendor
        </Link>
      </div>

      <form className="flex gap-2" method="get">
        <input
          name="q"
          defaultValue={search.q ?? ''}
          placeholder={`Search ${titleFor(direction).toLowerCase()}`}
          className="lx-field min-w-0 flex-1 px-4 py-3 text-sm"
        />
        <button type="submit" className="lx-btn-amber px-4 py-3 text-sm">Search</button>
      </form>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-[18px] border border-white/8 bg-white/[0.04] p-5">
            <p className="text-sm text-slate-400">No {titleFor(direction).toLowerCase()} match your filters.</p>
          </div>
        ) : rows.map(({ profile, createdAt }) => (
          <div key={profile.id} className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] p-3 transition hover:bg-white/[0.08]">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10 text-xs font-semibold text-slate-300">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt={profile.display_name ?? profile.handle ?? 'Profile'} className="h-full w-full object-cover" />
              ) : (
                <DefaultAvatar />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{profile.display_name ?? 'LumeX user'}</p>
              <p className="truncate text-xs text-slate-400">@{profile.handle ?? 'user'} · {new Date(createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</p>
            </div>
            <Link href={`/vendor/${vendorId}`} className="rounded-full border border-white/8 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300">
              View
            </Link>
          </div>
        ))}
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <Link href={`?${new URLSearchParams({ q: search.q ?? '', cursor: nextCursor }).toString()}`} className="rounded-full border border-white/8 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300">
            Load more
          </Link>
        </div>
      )}
    </section>
  )
}
