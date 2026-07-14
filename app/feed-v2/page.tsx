import { FeedV2Screen } from '@/components/feed-v2/feed-v2-screen'
import { loadFeedV2Surface, type FeedV2RightRailData, type FeedV2TabKey } from '@/lib/feed/v2'
import { feedV2LeftNav, feedV2Tabs, type FeedV2Post, type FeedV2Story, type FeedV2Tab } from './fixtures'

const tabByLabel: Record<string, FeedV2TabKey> = {
  'for-you': 'for_you',
  following: 'following',
  nearby: 'nearby',
  deals: 'deals',
  trending: 'trending',
}

function normalizeTab(input?: string | string[]) {
  const value = Array.isArray(input) ? input[0] : input
  return value && value in tabByLabel ? tabByLabel[value] : 'for_you'
}

function tabsForActive(active: FeedV2TabKey): FeedV2Tab[] {
  const labelByKey: Record<FeedV2TabKey, string> = {
    for_you: 'For You',
    following: 'Following',
    nearby: 'Nearby',
    deals: 'Deals',
    trending: 'Trending',
  }
  return feedV2Tabs.map((tab) => ({
    ...tab,
    active: tab.label === labelByKey[active],
  }))
}

export default async function FeedV2Page({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const params = await searchParams
  const activeTab = normalizeTab(params?.tab)
  let livePosts: FeedV2Post[] = []
  let liveStories: FeedV2Story[] = []
  let liveRightRail: FeedV2RightRailData = { topics: [], vendors: [], collections: [] }

  try {
    const live = await loadFeedV2Surface({ tab: activeTab })
    livePosts = live.posts
    liveStories = live.stories
    liveRightRail = live.rightRail
  } catch (error) {
    console.error('[feed-v2] live data load failed:', error instanceof Error ? error.message : error)
  }

  return (
    <FeedV2Screen
      posts={livePosts}
      stories={liveStories}
      tabs={tabsForActive(activeTab)}
      leftNav={feedV2LeftNav}
      rightRail={liveRightRail}
    />
  )
}
