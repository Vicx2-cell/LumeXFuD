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
  const roleCopy = session.role === 'vendor'
    ? {
        title: 'Vendor studio',
        subtitle: 'Post menu updates, watch engagement, and turn viewers into buyers.',
        accent: 'var(--lx-amber)',
      }
    : session.role === 'rider'
      ? {
          title: 'Rider pulse',
          subtitle: 'Track hotspots, orders, and creator posts that drive delivery demand.',
          accent: 'var(--lx-green)',
        }
      : {
          title: 'Discover feed',
          subtitle: 'Swipe through meals, creators, promos, and vendors in one clean stream.',
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
    <main className="lx-page px-4 py-6 pb-24">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="LumeX Feed"
          subtitle="Commerce-first discovery with conversation, promotions, and creator intent."
          badge="Social Commerce"
          back={false}
        />

        <section className="lx-surface p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/40">Role view</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">{roleCopy.title}</h2>
              <p className="mt-1 text-sm text-white/65">{roleCopy.subtitle}</p>
            </div>
            <Badge color={roleCopy.accent}>{session.role}</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-wide text-white/40">Ranking engine</p>
              <p className="mt-1 text-white font-semibold">Version {snapshot.version}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-wide text-white/40">Visible tabs</p>
              <p className="mt-1 text-white font-semibold">{Object.values(snapshot.tabs).filter(Boolean).length} active</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-wide text-white/40">Current tab</p>
              <p className="mt-1 text-white font-semibold capitalize">{snapshot.tab.replaceAll('_', ' ')}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.entries(snapshot.tabs).map(([key, enabled]) => (
              <span
                key={key}
                className="rounded-full px-3 py-1.5 text-xs font-medium border"
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
