import { notFound } from 'next/navigation'
import { FeedV2Screen } from '@/components/feed-v2/feed-v2-screen'
import { loadFeedV2Surface } from '@/lib/feed/v2'
import { feedV2LeftNav, feedV2Tabs } from '../../types'

export const dynamic = 'force-dynamic'

export default async function FeedPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const surface = await loadFeedV2Surface({ postId: id }).catch(() => null)
  if (!surface?.posts[0]) notFound()

  return (
    <FeedV2Screen
      posts={[surface.posts[0]]}
      stories={[]}
      tabs={feedV2Tabs.map((tab) => ({ ...tab, active: tab.label === 'For You' }))}
      leftNav={feedV2LeftNav}
      rightRail={surface.rightRail}
    />
  )
}
