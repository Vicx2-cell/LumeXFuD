import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/session'
import { loadFeedSnapshot } from '@/lib/feed/service'
import { Badge } from '@/components/ui/badge'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { FeedClient } from './feed-client'

export const dynamic = 'force-dynamic'

export default async function FeedPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>
}) {
  const session = await getCurrentUser()
  if (!session) redirect('/auth?next=/feed')

  const search = ((await (searchParams ?? Promise.resolve({})).catch(() => ({}))) as { tab?: string })
  const snapshot = await loadFeedSnapshot(search.tab)
  const roleCopy = session.role === 'vendor'
    ? {
        title: 'Studio',
        subtitle: 'Post, promote, and watch what customers respond to.',
        accent: 'var(--lx-amber)',
      }
    : session.role === 'rider'
      ? {
          title: 'Pulse',
          subtitle: 'See what is moving around campus.',
          accent: 'var(--lx-green)',
        }
      : {
          title: 'Feed',
          subtitle: 'Food posts, deals, and campus cravings.',
          accent: 'var(--lx-blue)',
        }

  let menuItems: Array<{ id: string; name: string; price_kobo: number; is_available: boolean }> = []
  if (session.role === 'vendor' && session.userId) {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('menu_items')
      .select('id, name, price_kobo, is_available')
      .eq('vendor_id', session.userId)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
    menuItems = (data ?? []) as Array<{ id: string; name: string; price_kobo: number; is_available: boolean }>
  }

  return (
    <main className="lx-page pb-24">
      <div className="sticky top-0 z-40 border-b border-white/8 bg-black/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-normal text-white">LumeX {roleCopy.title}</h1>
              <Badge color={roleCopy.accent}>{session.role}</Badge>
            </div>
            <p className="truncate text-xs text-white/45">{roleCopy.subtitle}</p>
          </div>
          <Link href={session.role === 'vendor' ? '/vendor-dashboard' : session.role === 'rider' ? '/rider' : '/'} className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white/70">
            Home
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-0 sm:px-4 sm:py-5">
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
    </main>
  )
}
