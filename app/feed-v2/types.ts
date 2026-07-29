export type FeedV2Tab = {
  label: string
  active?: boolean
}

export type FeedV2Story = {
  label: string
  meta: string
  avatarUrl?: string | null
  image?: string | null
  mediaKind?: 'image' | 'video'
  text?: string | null
  live?: boolean
  active?: boolean
  publisherType?: 'vendor' | 'ambassador' | 'lumex' | 'super_admin' | 'student'
  approvalState?: 'approved' | 'pending'
  dailyLimit?: number
}

export type FeedV2LeftNavIcon = 'home' | 'feed' | 'orders' | 'saved' | 'wallet' | 'profile'

export type FeedV2LeftNavItem = {
  label: string
  href: string
  icon: FeedV2LeftNavIcon
  active?: boolean
}

export type FeedV2RailTopic = {
  label: string
  meta: string
  image: string
}

export type FeedV2RailVendor = {
  name: string
  meta: string
  image: string
}

export type FeedV2RailCollection = {
  title: string
  meta: string
}

type FeedV2BasePost = {
  id: string
  vendorId?: string
  menuItemId?: string
  quotedPost?: { id: string; body: string }
  authorProfileId?: string
  author: string
  handle: string
  area: string
  campusId?: string
  zoneId?: string
  time: string
  avatar?: string
  tags?: string[]
  verified?: boolean
  statusPills?: string[]
  ctaLabel?: string
  viewCount?: number
  likeCount?: number
  replyCount?: number
  repostCount?: number
  saveCount?: number
  shareCount?: number
  viewerLiked?: boolean
  viewerSaved?: boolean
  viewerReposted?: boolean
  viewerFollows?: boolean
}

export type FeedV2Post =
  | (FeedV2BasePost & {
      kind: 'text'
      body: string
      publisherType?: 'vendor' | 'official' | 'ambassador' | 'student'
      approvalState?: 'approved' | 'pending'
      linkedVendor?: string
      linkedMenuItem?: string
      expiresAt?: string
    })
  | (FeedV2BasePost & {
      kind: 'image' | 'meme' | 'video'
      body: string
      image: string
      ratio: 'wide' | 'square' | 'portrait'
      media?: Array<{
        src: string
        kind?: 'image' | 'video'
        overlayText?: string
      }>
      publisherType?: 'vendor' | 'official' | 'ambassador' | 'student'
      approvalState?: 'approved' | 'pending'
      linkedVendor?: string
      linkedMenuItem?: string
      expiresAt?: string
    })
  | (FeedV2BasePost & {
      kind: 'menu'
      body: string
      item: {
        name: string
        vendor: string
        price: string
        image: string
        available: boolean
      }
      publisherType?: 'vendor' | 'official' | 'ambassador' | 'student'
      approvalState?: 'approved' | 'pending'
      linkedVendor?: string
      linkedMenuItem?: string
      expiresAt?: string
    })
  | (FeedV2BasePost & {
      kind: 'official'
      author: 'LumeX Fud'
      handle: 'lumex'
      title: string
      body: string
      image?: string
      officialNote?: string
      publisherType?: 'official'
      approvalState?: 'approved'
      expiresAt?: string
    })
  | (FeedV2BasePost & {
      kind: 'collection'
      author: 'LumeX Fud'
      handle: 'lumex'
      title: string
      body: string
      items: Array<{
        name: string
        vendor: string
        price: string
        image: string
        available: boolean
      }>
      publisherType?: 'official'
      approvalState?: 'approved'
      expiresAt?: string
    })

export const feedV2Tabs: FeedV2Tab[] = [
  { label: 'For You', active: true },
  { label: 'Following' },
  { label: 'Nearby' },
  { label: 'Deals' },
  { label: 'Trending' },
]

export const feedV2LeftNav: FeedV2LeftNavItem[] = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Feed', href: '/feed-v2', icon: 'feed', active: true },
  { label: 'Orders', href: '/orders', icon: 'orders' },
  { label: 'Saved', href: '/saved', icon: 'saved' },
  { label: 'Wallet', href: '/wallet', icon: 'wallet' },
  { label: 'Profile', href: '/profile', icon: 'profile' },
]
