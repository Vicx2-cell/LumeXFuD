import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { loadFeedSnapshot } from '@/lib/feed/service'
import { PageHeader } from '@/components/ui/page-header'
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
    <main className="lx-page px-4 py-6 pb-24">
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader
          title="LumeX Feed"
          subtitle="Commerce-first discovery with conversation, promotions, and creator intent."
          badge="Social Commerce"
          back={false}
        />

        <section className="lx-surface p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/40">Ranking engine</p>
              <p className="text-sm text-white/75 mt-1">Version {snapshot.version}</p>
            </div>
            <Badge color="var(--lx-amber)">Authenticated</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(snapshot.tabs).map(([key, enabled]) => (
              <span
                key={key}
                className="rounded-full px-3 py-1 text-xs font-medium border"
                style={{
                  borderColor: enabled ? 'rgba(245,166,35,0.35)' : 'rgba(255,255,255,0.08)',
                  color: enabled ? '#F5A623' : 'rgba(255,255,255,0.4)',
                  background: enabled ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.03)',
                }}
              >
                {key.replaceAll('_', ' ')}
              </span>
            ))}
          </div>
        </section>

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
