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

export const feedV2Stories: FeedV2Story[] = []

export const feedV2LeftNav: FeedV2LeftNavItem[] = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Feed', href: '/feed-v2', icon: 'feed', active: true },
  { label: 'Orders', href: '/orders', icon: 'orders' },
  { label: 'Saved', href: '/saved', icon: 'saved' },
  { label: 'Wallet', href: '/wallet', icon: 'wallet' },
  { label: 'Profile', href: '/profile', icon: 'profile' },
]

export const feedV2Posts: FeedV2Post[] = [
  {
    kind: 'text',
    id: 'late-lunch-note',
    author: 'Ada Nwosu',
    handle: 'adanwosu',
    avatar: '/icons/apple-touch-icon-v2.png',
    area: 'Umuahia Gate',
    time: '8m',
    body: 'Main Gate is moving fast this afternoon. The swallow spot beside the pharmacy still has no queue if you go now.',
    tags: ['lunch', 'uturu'],
    publisherType: 'ambassador',
    approvalState: 'approved',
    verified: true,
    statusPills: ['Open now', '12min'],
    ctaLabel: 'Order Now',
    viewCount: 842,
    expiresAt: '2026-07-15T08:08:00.000Z',
  },
  {
    kind: 'image',
    id: 'jollof-rush',
    author: 'Bites by Mira',
    handle: 'bitesbymira',
    avatar: '/icons/apple-touch-icon.png',
    area: 'Hostel C',
    time: '14m',
    body: 'Jollof sold out early again. This tray is the last one from the morning batch.',
    image: '/premium/dish-1.jpg',
    ratio: 'wide',
    tags: ['jollof', 'campusfood'],
    publisherType: 'vendor',
    approvalState: 'approved',
    verified: true,
    statusPills: ['Open now', 'Room delivery'],
    ctaLabel: 'Order Now',
    viewCount: 1240,
    media: [
      { src: '/premium/dish-1.jpg' },
      { src: '/premium/dish-2.jpg' },
    ],
    expiresAt: '2026-07-15T12:14:00.000Z',
  },
  {
    kind: 'video',
    id: 'campus-bite-video',
    author: 'Chidera Eats',
    handle: 'chideraeats',
    avatar: '/icons/icon-512-v2.png',
    area: 'New Boys Hostel',
    time: '21m',
    body: 'This wrap was better than the line made it look.',
    image: '/premium/dish-2.jpg',
    ratio: 'portrait',
    tags: ['wrap', 'snackbreak'],
    publisherType: 'vendor',
    approvalState: 'approved',
    verified: true,
    statusPills: ['Last batch', '14min'],
    ctaLabel: 'Order Now',
    viewCount: 978,
    media: [{ src: '/premium/dish-2.jpg', kind: 'video', overlayText: 'Fresh wrap coming through' }],
    expiresAt: '2026-07-15T11:21:00.000Z',
  },
  {
    kind: 'meme',
    id: 'midnight-meme',
    author: 'Campus Cruise',
    handle: 'campuscruise',
    avatar: '/icons/icon-maskable-512-v2.png',
    area: 'ABSU',
    time: '29m',
    body: 'When you said you wanted only small rice and the meat disappeared first.',
    image: '/premium/dish-3.jpg',
    ratio: 'square',
    tags: ['campus', 'latebite'],
    publisherType: 'student',
    approvalState: 'approved',
    linkedVendor: 'Campus Pot',
    linkedMenuItem: 'Peppered Rice Bowl',
    verified: false,
    statusPills: ['Trending', 'Tagged vendor'],
    ctaLabel: 'Order Now',
    viewCount: 611,
    media: [{ src: '/premium/dish-3.jpg', overlayText: 'POV: you said one snack and got invited to eat for real' }],
    expiresAt: '2026-07-15T09:29:00.000Z',
  },
  {
    kind: 'menu',
    id: 'shawarma-menu',
    author: 'Bites by Mira',
    handle: 'bitesbymira',
    avatar: '/icons/apple-touch-icon.png',
    area: 'Uturu Road',
    time: '36m',
    body: 'Chicken shawarma is live for evening orders.',
    item: {
      name: 'Smoky Chicken Shawarma',
      vendor: 'Bites by Mira',
      price: 'NGN 2,400',
      image: '/premium/delivery.jpg',
      available: true,
    },
    publisherType: 'vendor',
    approvalState: 'approved',
    verified: true,
    statusPills: ['Open now', '12min'],
    ctaLabel: 'Order Now',
    viewCount: 1490,
    expiresAt: '2026-07-15T12:36:00.000Z',
  },
  {
    kind: 'official',
    id: 'official-night',
    author: 'LumeX Fud',
    handle: 'lumex',
    area: 'ABSU, Uturu',
    time: '45m',
    title: 'Seven vendors are still delivering after 10PM',
    body: 'Useful for late study nights: these are verified open spots with delivery still enabled.',
    image: '/premium/hero-food.jpg',
    officialNote: 'Tap to see the live list of vendors still accepting orders tonight.',
    publisherType: 'official',
    approvalState: 'approved',
    statusPills: ['Official', 'Live campus update'],
    ctaLabel: 'See Available Vendors',
    viewCount: 2012,
    expiresAt: '2026-07-15T23:45:00.000Z',
  },
  {
    kind: 'collection',
    id: 'exam-week-collection',
    author: 'LumeX Fud',
    handle: 'lumex',
    area: 'ABSU, Uturu',
    time: '58m',
    title: 'Meals under NGN 2,500 for exam week',
    body: 'Compact, filling meals from vendors currently available around campus.',
    items: [
      { name: 'Jollof Bowl', vendor: 'Mama Uche', price: 'NGN 2,000', image: '/premium/dish-1.jpg', available: true },
      { name: 'Chicken Wrap', vendor: 'Bites by Mira', price: 'NGN 2,400', image: '/premium/dish-2.jpg', available: true },
      { name: 'Rice and Plantain', vendor: 'Campus Pot', price: 'NGN 2,300', image: '/premium/dish-3.jpg', available: true },
    ],
    publisherType: 'official',
    approvalState: 'approved',
    statusPills: ['Official', 'Exam week'],
    ctaLabel: 'See Available Vendors',
    viewCount: 1678,
    expiresAt: '2026-07-15T20:58:00.000Z',
  },
  {
    kind: 'menu',
    id: 'unavailable-item',
    author: 'Campus Pot',
    handle: 'campuspot',
    avatar: '/icons/icon-192-v2.png',
    area: 'Okigwe Road',
    time: '1h',
    body: 'Peppered turkey returns tomorrow after restock.',
    item: {
      name: 'Peppered Turkey Plate',
      vendor: 'Campus Pot',
      price: 'NGN 3,200',
      image: '/premium/hero-food-mobile.jpg',
      available: false,
    },
    publisherType: 'vendor',
    approvalState: 'approved',
    verified: true,
    statusPills: ['Restocking', 'Tomorrow'],
    ctaLabel: 'Order Now',
    viewCount: 734,
    expiresAt: '2026-07-15T01:00:00.000Z',
  },
]

export const feedV2SeedPosts = feedV2Posts

export const feedV2RightRail = {
  topics: [
    { label: 'Jollof', meta: '18 posts today', image: '/premium/dish-1.jpg' },
    { label: 'Shawarma', meta: '11 posts today', image: '/premium/dish-2.jpg' },
    { label: 'Late night', meta: '8 posts today', image: '/premium/delivery.jpg' },
  ] satisfies FeedV2RailTopic[],
  vendors: [
    { name: 'Mama Uche', meta: 'Open until 11:30PM', image: '/premium/dish-1.jpg' },
    { name: 'Bites by Mira', meta: 'Fast around Hostel C', image: '/premium/dish-2.jpg' },
    { name: 'Campus Pot', meta: 'Rice bowls trending', image: '/premium/dish-3.jpg' },
  ] satisfies FeedV2RailVendor[],
  collections: [
    { title: 'Meals under NGN 2,500', meta: '3 strong picks' },
    { title: 'Late night bites', meta: 'Open vendors only' },
    { title: 'Study break snacks', meta: 'Fast options' },
  ] satisfies FeedV2RailCollection[],
}
