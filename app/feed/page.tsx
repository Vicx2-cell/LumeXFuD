import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { loadFeedSnapshot } from '@/lib/feed/service'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { FeedClient } from './feed-client'
import { FeedShell } from './feed-shell'
import { getCampusDeals, getFeaturedVendors, getTrendingTopics } from '@/lib/feed/discovery'

export const dynamic = 'force-dynamic'

function roleMeta(role: 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin') {
  if (role === 'vendor') {
    return {
      title: 'Studio',
      subtitle: 'Post, promote, and watch what customers respond to.',
      badge: 'Vendor',
    }
  }
  if (role === 'rider') {
    return {
      title: 'Pulse',
      subtitle: 'See what is moving around campus.',
      badge: 'Rider',
    }
  }
  return {
    title: 'Feed',
    subtitle: 'Food posts, deals, and campus cravings.',
    badge: role === 'customer' ? 'Customer' : 'Admin',
  }
}

function ownerColumn(role: 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin') {
  if (role === 'vendor') return 'vendor_id'
  if (role === 'rider') return 'rider_id'
  if (role === 'admin' || role === 'super_admin') return 'admin_id'
  return 'customer_id'
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>
}) {
  const session = await getCurrentUser()
  if (!session) redirect('/auth?next=/feed')

  const search = ((await (searchParams ?? Promise.resolve({})).catch(() => ({}))) as { tab?: string })
  const snapshot = await loadFeedSnapshot(search.tab)
  const roleCopy = roleMeta(session.role)

  let menuItems: Array<{ id: string; name: string; price_kobo: number; is_available: boolean }> = []
  let profileName = session.name ?? session.phone
  let profileHandle = session.phone
  let campusName: string | null = null
  let campusState: string | null = null
  if (session.role === 'vendor' && session.userId) {
    const db = createSupabaseAdmin()
    const owner = ownerColumn(session.role)
    const { data: profile } = await db
      .from('social_profiles')
      .select('display_name, handle, campus_id')
      .eq(owner, session.userId)
      .maybeSingle()
    profileName = (profile?.display_name as string | null)?.trim() || profileName
    profileHandle = (profile?.handle as string | null)?.trim() || profileHandle
    if (profile?.campus_id) {
      const { data: campus } = await db.from('cities').select('name, state').eq('id', profile.campus_id).maybeSingle()
      campusName = campus?.name ?? null
      campusState = campus?.state ?? null
    }
    const { data } = await db
      .from('menu_items')
      .select('id, name, price_kobo, is_available')
      .eq('vendor_id', session.userId)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
    menuItems = (data ?? []) as Array<{ id: string; name: string; price_kobo: number; is_available: boolean }>
  } else {
    const db = createSupabaseAdmin()
    const owner = ownerColumn(session.role)
    const { data: profile } = await db
      .from('social_profiles')
      .select('display_name, handle, campus_id')
      .eq(owner, session.userId ?? '')
      .maybeSingle()
    profileName = (profile?.display_name as string | null)?.trim() || profileName
    profileHandle = (profile?.handle as string | null)?.trim() || profileHandle
    if (profile?.campus_id) {
      const { data: campus } = await db.from('cities').select('name, state').eq('id', profile.campus_id).maybeSingle()
      campusName = campus?.name ?? null
      campusState = campus?.state ?? null
    }
  }

  const trendingTopics = getTrendingTopics(snapshot.items, 5)
  const featuredVendors = getFeaturedVendors(snapshot.items, 5)
  const campusDeals = getCampusDeals(snapshot.items, 4)

  return (
    <FeedShell
      role={session.role}
      roleLabel={roleCopy.title}
      roleSubtitle={roleCopy.subtitle}
      profileName={profileName}
      profileHandle={profileHandle}
      profileBadge={roleCopy.badge}
      campusName={campusName}
      campusState={campusState}
      selectedTab={snapshot.tab}
      trendingTopics={trendingTopics}
      featuredVendors={featuredVendors}
      campusDeals={campusDeals}
    >
      <div className="mx-auto min-w-0 max-w-[760px] px-0 sm:px-0">
        <FeedClient
          tab={snapshot.tab}
          tabs={snapshot.tabs}
          items={snapshot.items}
          sessionRole={session.role}
          menuItems={menuItems}
          nextCursor={snapshot.nextCursor}
          hasMore={snapshot.hasMore}
        />
      </div>
    </FeedShell>
  )
}
