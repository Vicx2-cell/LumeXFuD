'use client'

import { FormEvent, MouseEvent, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Heart,
  Home,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  Search,
  ShoppingBag,
  Sparkles,
  X,
  Share2,
  Flame,
  User,
  Wallet,
  Volume2,
  VolumeX,
} from 'lucide-react'
import styles from '@/app/feed-v2/feed-v2.module.css'
import { BrandLogo } from '@/components/brand-logo'
import { DefaultAvatar } from '@/components/default-avatar'
import type {
  FeedV2LeftNavIcon,
  FeedV2LeftNavItem,
  FeedV2Post,
  FeedV2RailCollection,
  FeedV2RailTopic,
  FeedV2RailVendor,
  FeedV2Story,
  FeedV2Tab,
} from '@/app/feed-v2/fixtures'

type FeedV2ScreenProps = {
  posts: FeedV2Post[]
  stories: FeedV2Story[]
  tabs: FeedV2Tab[]
  leftNav: FeedV2LeftNavItem[]
  rightRail: {
    topics: FeedV2RailTopic[]
    vendors: FeedV2RailVendor[]
    collections: FeedV2RailCollection[]
  }
  menuOpenFor?: string | null
  isActionPending?: (postId: string, kind: string) => boolean
  onToggleMenu?: (post: FeedV2Post) => void
  onLike?: (post: FeedV2Post) => void
  onReply?: (post: FeedV2Post) => void
  onRepost?: (post: FeedV2Post) => void
  onQuote?: (post: FeedV2Post) => void
  onSave?: (post: FeedV2Post) => void
  onShare?: (post: FeedV2Post) => void
  onFollow?: (post: FeedV2Post) => void
  onReport?: (post: FeedV2Post) => void
  onNotInterested?: (post: FeedV2Post) => void
  onHideCreator?: (post: FeedV2Post) => void
  onMute?: (post: FeedV2Post) => void
  onBlock?: (post: FeedV2Post) => void
  onSelectTab?: (label: string) => void
}

type TimelineProps = Pick<FeedV2ScreenProps,
  'posts' | 'menuOpenFor' | 'isActionPending' | 'onToggleMenu' | 'onLike' | 'onReply' | 'onRepost' |
  'onQuote' | 'onSave' | 'onShare' | 'onFollow' | 'onReport' | 'onNotInterested' | 'onHideCreator' | 'onMute' | 'onBlock'>

type FeedComment = {
  id: string
  profileId: string
  body: string
  author: string
  handle: string | null
  avatarUrl: string | null
  likeCount: number
  replyCount: number
  createdAt: string
}

function isOfficial(post: FeedV2Post) {
  return post.kind === 'official' || post.author === 'LumeX Fud'
}

function canFollowPostAuthor(post: FeedV2Post) {
  return Boolean(post.authorProfileId && !isOfficial(post))
}

function profileHref(post: FeedV2Post) {
  return post.authorProfileId ? `/feed-v2/profile/${post.authorProfileId}` : null
}

function LeftNavIcon({ icon }: { icon: FeedV2LeftNavIcon }) {
  if (icon === 'home') return <Home size={18} aria-hidden="true" />
  if (icon === 'feed') return <Sparkles size={18} aria-hidden="true" />
  if (icon === 'orders') return <ShoppingBag size={18} aria-hidden="true" />
  if (icon === 'saved') return <Bookmark size={18} aria-hidden="true" />
  if (icon === 'wallet') return <Wallet size={18} aria-hidden="true" />
  return <User size={18} aria-hidden="true" />
}

function Reveal({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && !('IntersectionObserver' in window))

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -10% 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={`${styles.reveal} ${visible ? styles.revealVisible : ''} ${className}`}>
      {children}
    </div>
  )
}

function formatMeta(post: FeedV2Post) {
  return `${post.area} • ${post.time}`
}

function formatViewCount(viewCount?: number) {
  if (viewCount == null) return null
  return `${new Intl.NumberFormat('en-US').format(viewCount)} qualified views`
}

function formatActionCount(count?: number) {
  if (count == null) return ''
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count)
}

function formatCommentTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  if (elapsed < 60_000) return 'now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  return `${Math.floor(elapsed / 86_400_000)}d`
}

function stopPostClick(event: MouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

function feedEventKey(kind: string, postId: string) {
  return `${kind}-${postId.slice(0, 18)}-${Date.now().toString(36)}`
}

function feedBatchKey(kind: string) {
  return `feed-v2-${kind}-${Date.now().toString(36)}`
}

async function recordFeedEvent(postId: string, eventType: 'qualified_impression' | 'share') {
  await fetch('/api/feed/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch_key: feedBatchKey(eventType),
      source_tab: 'for_you',
      events: [{
        event_key: feedEventKey(eventType, postId),
        post_id: postId,
        event_type: eventType,
        metadata: { surface: 'feed-v2' },
      }],
    }),
  }).catch(() => {})
}

function statusTone(label: string) {
  const normalized = label.toLowerCase()
  if (
    normalized.includes('open') ||
    normalized.includes('live') ||
    normalized.includes('delivery') ||
    normalized.includes('verified') ||
    normalized.includes('available') ||
    normalized.includes('sold')
  ) {
    return 'success'
  }
  return 'amber'
}

function verificationBadgeClass(tone: 'official' | 'vendor' | 'ambassador') {
  if (tone === 'official') return `${styles.verifiedBadge} ${styles.verifiedBadgeOfficial}`
  if (tone === 'ambassador') return `${styles.verifiedBadge} ${styles.verifiedBadgeAmbassador}`
  return `${styles.verifiedBadge} ${styles.verifiedBadgeVendor}`
}

function Avatar({ post }: { post: FeedV2Post }) {
  if (post.author === 'LumeX Fud') {
    return (
      <div className={`${styles.avatar} ${styles.avatarBrand}`}>
        <BrandLogo size={50} rounded={9999} className={styles.avatarBrandLogo} />
      </div>
    )
  }

  if (post.kind === 'text') {
    return (
      <div className={styles.avatar}>
        <DefaultAvatar className={styles.avatarFallback} />
      </div>
    )
  }

  if (post.avatar) {
    return (
      <div className={styles.avatar}>
        <Image src={post.avatar} alt="" fill sizes="56px" className="object-cover" />
      </div>
    )
  }

  if (post.kind === 'official' || post.kind === 'collection') {
    return (
      <div className={`${styles.avatar} ${styles.avatarBrand}`}>
        <BrandLogo size={50} rounded={9999} className={styles.avatarBrandLogo} />
      </div>
    )
  }

  return (
    <div className={styles.avatar}>
      <DefaultAvatar className={styles.avatarFallback} />
    </div>
  )
}

function PostHeader({
  post,
  onToggleMenu,
  onFollow,
  followingAuthor,
  followPending,
}: {
  post: FeedV2Post
  onToggleMenu?: (post: FeedV2Post) => void
  onFollow?: (post: FeedV2Post) => void
  followingAuthor?: boolean
  followPending?: boolean
}) {
  const official = isOfficial(post)
  const badgeTone = official
    ? 'official'
    : post.publisherType === 'ambassador' && post.verified
      ? 'ambassador'
      : post.publisherType === 'vendor' && post.verified
        ? 'vendor'
        : null
  const badgeTitle = badgeTone === 'official'
    ? 'Verified official account'
    : badgeTone === 'ambassador'
      ? 'Approved ambassador'
      : badgeTone === 'vendor'
        ? 'Verified vendor'
        : ''

  return (
    <header className={styles.postHeader}>
      {profileHref(post) ? (
        <Link href={profileHref(post)!} className={styles.authorLink} onClick={(event) => event.stopPropagation()} aria-label={`Open ${post.author}'s profile`}>
          <Avatar post={post} />
        </Link>
      ) : <Avatar post={post} />}
      <div className={styles.postHeaderCopy}>
        <div className={styles.postAuthorRow}>
          {profileHref(post) ? (
            <Link href={profileHref(post)!} className={styles.authorName} onClick={(event) => event.stopPropagation()}>{post.author}</Link>
          ) : <span className={styles.authorName}>{post.author}</span>}
          {badgeTone ? (
            <span className={verificationBadgeClass(badgeTone)} title={badgeTitle} aria-label={badgeTitle}>
              <BadgeCheck size={16} fill="currentColor" strokeWidth={2.6} aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <p className={styles.postMeta}>{formatMeta(post)}</p>
      </div>
      {canFollowPostAuthor(post) ? (
        <button
          type="button"
          className={`${styles.inlineFollowButton} ${followingAuthor ? styles.inlineFollowButtonActive : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            onFollow?.(post)
          }}
          disabled={followPending}
          aria-pressed={followingAuthor}
        >
          {followingAuthor ? 'Following' : 'Follow'}
        </button>
      ) : null}
      {!official ? <button
        type="button"
        className={styles.moreButton}
        aria-label="More options"
        onClick={(event) => {
          event.stopPropagation()
          onToggleMenu?.(post)
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button> : null}
    </header>
  )
}

function PostBody({
  post,
  onDoubleTapLike,
}: {
  post: FeedV2Post
  onDoubleTapLike?: (post: FeedV2Post) => void
}) {
  if (post.kind === 'official') {
    return (
      <div className={styles.officialBody}>
        <p className={styles.officialEyebrow}>Campus Update</p>
        <p className={styles.postBody}>{post.body}</p>
        {post.image ? (
          <div className={styles.mediaFrame}>
            <Image src={post.image} alt={post.title} fill sizes="(max-width: 767px) 100vw, 760px" className="object-cover" />
          </div>
        ) : null}
      </div>
    )
  }

  if (post.kind === 'menu') {
    return (
      <div className={styles.menuBlock}>
        <p className={styles.postBody}>{post.body}</p>
        <div className={styles.menuCard}>
          <div className={styles.menuThumb}>
            <Image src={post.item.image} alt="" fill sizes="(max-width: 767px) 100vw, 720px" className="object-cover" />
          </div>
          <div className={styles.menuCopy}>
            <div className={styles.menuNameRow}>
              <span className={styles.menuName}>{post.item.name}</span>
              <span className={post.item.available ? styles.price : styles.priceMuted}>{post.item.price}</span>
            </div>
            <span className={styles.menuVendor}>{post.item.vendor}</span>
            <p className={styles.menuMeta}>{post.item.available ? 'Available now' : 'Currently unavailable'}</p>
          </div>
        </div>
      </div>
    )
  }

  if (post.kind === 'collection') {
    return (
      <div className={styles.collectionBlock}>
        <h2 className={styles.collectionTitle}>{post.title}</h2>
        <p className={styles.postBody}>{post.body}</p>
        <div className={styles.collectionList}>
          {post.items.map((item) => (
            <div key={`${item.vendor}-${item.name}`} className={styles.collectionRow}>
              <div className={styles.collectionThumb}>
                <Image src={item.image} alt="" fill sizes="56px" className="object-cover" />
              </div>
              <div className={styles.collectionCopy}>
                <div className={styles.menuNameRow}>
                  <span className={styles.menuName}>{item.name}</span>
                  <span className={item.available ? styles.price : styles.priceMuted}>{item.price}</span>
                </div>
                <p className={styles.menuMeta}>{item.vendor}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (post.kind === 'text') {
    return (
      <div className={styles.textBlock}>
        <p className={styles.postBody}>{post.body}</p>
        <Tags tags={post.tags} />
      </div>
    )
  }

  return (
    <div className={styles.mediaPostBody}>
      <p className={styles.postBody}>{post.body}</p>
      <PostMedia post={post} onDoubleTapLike={onDoubleTapLike} />
      <Tags tags={post.tags} />
    </div>
  )
}

function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null
  return (
    <div className={styles.tags}>
      {tags.slice(0, 1).map((tag) => (
        <span key={tag} className={styles.tag}>
          {tag.startsWith('#') ? tag : `#${tag}`}
        </span>
      ))}
    </div>
  )
}

function PostMedia({
  post,
  onDoubleTapLike,
}: {
  post: Extract<FeedV2Post, { kind: 'image' | 'video' | 'meme' }>
  onDoubleTapLike?: (post: FeedV2Post) => void
}) {
  const media = post.media?.length
    ? post.media
    : [{ src: post.image, kind: post.kind === 'video' ? 'video' : 'image' }]

  const layoutClass =
    media.length === 1
      ? styles.mediaSingle
      : media.length === 2
        ? styles.mediaPair
        : media.length === 3
          ? styles.mediaTriple
          : styles.mediaQuad

  return (
    <div
      className={`${styles.mediaGrid} ${layoutClass}`}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDoubleTapLike?.(post)
      }}
    >
      {media.slice(0, 4).map((item, index) => (
        <div key={`${post.id}-${item.src}-${index}`} className={styles.mediaFrame}>
          {(() => {
            const overlayText = 'overlayText' in item ? item.overlayText : undefined
            return overlayText ? (
              <div className={styles.mediaOverlay}>
                <span>{overlayText}</span>
              </div>
            ) : null
          })()}
          {item.kind === 'video' ? (
            <video src={item.src} className={styles.feedVideo} controls playsInline preload="metadata" onClick={(event) => event.stopPropagation()} />
          ) : (
            <Image src={item.src} alt={post.body} fill sizes="(max-width: 767px) 100vw, 760px" className="object-cover" />
          )}
          {item.kind === 'video' && index === 0 ? (
            <div className={styles.playBadge}>
              <span className={styles.playChip}>
                <Play size={19} fill="currentColor" aria-hidden="true" />
              </span>
            </div>
          ) : null}
        </div>
      ))}
      {media.length > 1 ? <span className={styles.mediaCount}>{media.length} shots</span> : null}
    </div>
  )
}

function ActionRow({
  post,
  isActionPending,
  liked,
  reposted,
  saved,
  onLike,
  onReply,
  onRepost,
  onSave,
  onShare,
  onOrderNow,
}: {
  post: FeedV2Post
  isActionPending?: (postId: string, kind: string) => boolean
  liked?: boolean
  reposted?: boolean
  saved?: boolean
  onLike?: (post: FeedV2Post) => void
  onReply?: (post: FeedV2Post) => void
  onRepost?: (post: FeedV2Post) => void
  onSave?: (post: FeedV2Post) => void
  onShare?: (post: FeedV2Post) => void
  onOrderNow?: (post: FeedV2Post) => void
}) {
  const orderLabel = post.ctaLabel?.trim() || null
  return (
    <div className={styles.actionRow} onClick={stopPostClick}>
      <div className={styles.actionCluster}>
        <button
          type="button"
          className={`${styles.actionButton} ${liked ? styles.actionButtonActive : ''}`}
          onClick={(event) => {
            stopPostClick(event)
            onLike?.(post)
          }}
          aria-label="Like"
          disabled={isActionPending?.(post.id, 'like')}
          aria-pressed={liked}
        >
          <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
          <span>{formatActionCount(post.likeCount)}</span>
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={(event) => {
            stopPostClick(event)
            onReply?.(post)
          }}
          aria-label="Comment"
          disabled={isActionPending?.(post.id, 'reply')}
        >
          <MessageCircle size={16} />
          <span>{formatActionCount(post.replyCount)}</span>
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${reposted ? styles.actionButtonActive : ''}`}
          onClick={(event) => {
            stopPostClick(event)
            onRepost?.(post)
          }}
          aria-label="Repost"
          disabled={isActionPending?.(post.id, 'repost')}
          aria-pressed={reposted}
        >
          <Repeat2 size={16} />
          <span>{formatActionCount(post.repostCount)}</span>
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${saved ? styles.actionButtonActive : ''}`}
          onClick={(event) => {
            stopPostClick(event)
            onSave?.(post)
          }}
          aria-label="Save"
          disabled={isActionPending?.(post.id, 'save')}
          aria-pressed={saved}
        >
          <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
          <span>{formatActionCount(post.saveCount)}</span>
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={(event) => {
            stopPostClick(event)
            onShare?.(post)
          }}
          aria-label="Share"
        >
          <Share2 size={16} />
          <span>{formatActionCount(post.shareCount)}</span>
        </button>
        {post.viewCount != null ? <p className={styles.viewCount}>{formatViewCount(post.viewCount)}</p> : null}
        {orderLabel ? (
          <button
            type="button"
            className={styles.orderButton}
            onClick={(event) => {
              stopPostClick(event)
              onOrderNow?.(post)
            }}
          >
            <span>{orderLabel}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function PostMenu({
  post,
  isActionPending,
  onFollow,
  followingAuthor,
  onQuote,
  onReport,
  onNotInterested,
  onHideCreator,
  onMute,
  onBlock,
}: {
  post: FeedV2Post
  isActionPending?: (postId: string, kind: string) => boolean
  onFollow?: (post: FeedV2Post) => void
  followingAuthor?: boolean
  onQuote?: (post: FeedV2Post) => void
  onReport?: (post: FeedV2Post) => void
  onNotInterested?: (post: FeedV2Post) => void
  onHideCreator?: (post: FeedV2Post) => void
  onMute?: (post: FeedV2Post) => void
  onBlock?: (post: FeedV2Post) => void
}) {
  if (isOfficial(post)) return null
  return (
    <div className={styles.postMenuPanel} role="menu" aria-label="Post actions">
      <button type="button" className={styles.postMenuItem} onClick={() => onFollow?.(post)} disabled={!canFollowPostAuthor(post) || isActionPending?.(post.id, 'follow')}>
        {followingAuthor ? 'Unfollow' : 'Follow'}
      </button>
      <button type="button" className={styles.postMenuItem} onClick={() => onQuote?.(post)}>Quote</button>
      <button type="button" className={styles.postMenuItem} onClick={() => onReport?.(post)}>Report</button>
      <button type="button" className={styles.postMenuItem} onClick={() => onNotInterested?.(post)}>Not interested</button>
      <button type="button" className={styles.postMenuItem} onClick={() => onHideCreator?.(post)}>Hide creator</button>
      <button type="button" className={styles.postMenuItem} onClick={() => onMute?.(post)} disabled={isActionPending?.(post.id, 'mute')}>Mute</button>
      <button type="button" className={styles.postMenuItem} onClick={() => onBlock?.(post)} disabled={isActionPending?.(post.id, 'block')}>Block</button>
    </div>
  )
}

function RailSection({
  title,
  children,
  subtitle,
}: {
  title: string
  children: ReactNode
  subtitle?: string
}) {
  return (
    <section className={styles.railSection}>
      <div className={styles.railHeading}>
        <div>
          <h3 className={styles.railTitle}>{title}</h3>
          {subtitle ? <p className={styles.railSubtitle}>{subtitle}</p> : null}
        </div>
      </div>
      <div className={styles.railBody}>{children}</div>
    </section>
  )
}

function LeftRail({ items }: { items: FeedV2LeftNavItem[] }) {
  return (
    <aside className={styles.leftRail} aria-label="Feed navigation">
      <div className={styles.leftRailInner}>
        <Link href="/" className={styles.brand}>
          <BrandLogo size={38} rounded={14} className={`${styles.brandMark} ${styles.brandMarkLifted}`} />
          <span className={styles.brandName}>LumeX Fud</span>
        </Link>
        <nav className={styles.leftNav}>
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`${styles.leftNavItem} ${item.active ? styles.leftNavItemActive : ''}`}
            >
              <LeftNavIcon icon={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.leftRailFooter}>
          <div className={styles.livePulseCard}>
            <div className={styles.livePulseDot} />
            <div>
              <p className={styles.livePulseTitle}>Campus is moving</p>
              <p className={styles.livePulseMeta}>Fresh drops, live vendors, quick ordering.</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function RightRail({
  rightRail,
}: {
  rightRail: FeedV2ScreenProps['rightRail']
}) {
  const hasTopics = rightRail.topics.length > 0
  const hasVendors = rightRail.vendors.length > 0
  const hasCollections = rightRail.collections.length > 0

  return (
    <aside className={styles.rightRail} aria-label="Discovery">
      <div className={styles.rightRailInner}>
        <div className={styles.rightRailHero}>
          <p className={styles.rightRailKicker}>
            <Flame size={13} aria-hidden="true" />
            Live campus feed
          </p>
          <h2 className={styles.rightRailTitle}>Fast taps to the best food on campus</h2>
          <p className={styles.rightRailCopy}>Trending dishes, verified vendors, and delivery windows that actually matter.</p>
        </div>

        {hasTopics ? (
          <RailSection title="Trending dishes" subtitle="What people are opening right now">
            <div className={styles.topicList}>
              {rightRail.topics.slice(0, 3).map((topic) => (
                <div key={topic.label} className={styles.topicRow}>
                  <div className={styles.topicThumb}>
                    <Image src={topic.image} alt="" fill sizes="64px" className="object-cover" />
                  </div>
                  <div className={styles.topicCopy}>
                    <span className={styles.topicLabel}>{topic.label}</span>
                    <span className={styles.topicMeta}>{topic.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </RailSection>
        ) : null}

        {hasVendors ? (
          <RailSection title="Nearby vendors" subtitle="Closest open options">
            <div className={styles.vendorList}>
              {rightRail.vendors.slice(0, 3).map((vendor) => (
                <div key={vendor.name} className={styles.vendorRow}>
                  <div className={styles.vendorThumb}>
                    <Image src={vendor.image} alt="" fill sizes="64px" className="object-cover" />
                  </div>
                  <div className={styles.vendorCopy}>
                    <span className={styles.topicLabel}>{vendor.name}</span>
                    <span className={styles.topicMeta}>{vendor.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </RailSection>
        ) : null}

        {hasCollections ? (
          <RailSection title="Quick picks" subtitle="Campus-friendly, low-friction meals">
            <div className={styles.pickList}>
              {rightRail.collections.slice(0, 3).map((collection) => (
                <div key={collection.title} className={styles.pickRow}>
                  <span className={styles.topicLabel}>{collection.title}</span>
                  <span className={styles.topicMeta}>{collection.meta}</span>
                </div>
              ))}
            </div>
          </RailSection>
        ) : null}
      </div>
    </aside>
  )
}

function Tabs({ tabs, onSelectTab }: { tabs: FeedV2Tab[]; onSelectTab?: (label: string) => void }) {
  const router = useRouter()
  const activeLabel = tabs.find((tab) => tab.active)?.label ?? tabs[0]?.label ?? ''

  return (
    <div className={styles.tabsWrap}>
      <div className={styles.tabs} aria-label="Feed sections">
        {tabs.map((tab) => {
          const active = tab.label === activeLabel
          const live = tab.label === 'Nearby'
          return (
            <button
              key={tab.label}
              type="button"
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              aria-pressed={active}
              onClick={() => {
                const slug = tab.label.toLowerCase().replace(/\s+/g, '-')
                router.push(`/feed-v2?tab=${slug}`)
                onSelectTab?.(tab.label)
              }}
            >
              <span>{tab.label}</span>
              {live ? <span className={styles.liveChip}>Live</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function storyRoleLabel(story: FeedV2Story) {
  if (story.approvalState === 'pending') return 'Pending approval'
  if (story.publisherType === 'student') return 'Student'
  if (story.publisherType === 'ambassador') return 'Ambassador'
  if (story.publisherType === 'super_admin') return 'Super Admin'
  if (story.publisherType === 'lumex') return 'LumeX Fud'
  return 'Vendor'
}

function Stories({
  stories,
  onOpenStory,
}: {
  stories: FeedV2Story[]
  onOpenStory: (index: number) => void
}) {
  return (
    <section className={styles.storiesShell} aria-label="Stories">
      <div className={styles.storiesRow}>
        <Link href="/feed-v2/create?mode=story" className={styles.storyItem} aria-label="Add story">
          <span className={`${styles.storyAvatarWrap} ${styles.storyAddAvatar}`}>
            <span className={styles.storyAddPlus}>+</span>
          </span>
          <span className={styles.storyLabel}>Add story</span>
        </Link>
        {stories.length === 0 ? null : stories.map((story, index) => (
          <button
            key={`${story.label}-${story.meta}`}
            type="button"
            className={styles.storyItem}
            onClick={() => onOpenStory(index)}
            aria-label={`Open story from ${story.label}`}
          >
            <span className={`${styles.storyAvatarWrap} ${(story.active || story.live) ? styles.storyAvatarUnseen : styles.storyAvatarSeen} ${story.live ? styles.storyAvatarLive : ''} ${story.approvalState === 'pending' ? styles.storyAvatarPending : ''}`}>
              <span className={styles.storyAvatar}>
                {story.publisherType === 'lumex' ? (
                  <BrandLogo size={28} rounded={9999} className={styles.avatarBrandLogo} />
                ) : story.avatarUrl ? (
                  <Image src={story.avatarUrl} alt="" fill sizes="56px" className="object-cover" />
                ) : (
                  <DefaultAvatar className={styles.storyAvatarFallback} size={15} />
                )}
              </span>
              </span>
            <span className={styles.storyLabel}>{story.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function SearchBar() {
  return (
    <div className={styles.searchRow}>
      <label className={styles.search}>
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          placeholder="Search food, vendors or places"
          aria-label="Search food, vendors or places"
        />
      </label>
      <button type="button" className={styles.iconButton} aria-label="Menu">
        <Menu size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

function Header({
  tabs,
  stories,
  onSelectTab,
  onOpenStory,
  headerRef,
}: {
  tabs: FeedV2Tab[]
  stories: FeedV2Story[]
  onSelectTab?: (label: string) => void
  onOpenStory: (index: number) => void
  headerRef?: RefObject<HTMLElement | null>
}) {
  return (
    <header ref={headerRef} className={styles.header}>
      <div className={styles.mobileBrandRow}>
        <div className={styles.mobileBrand}>
          <BrandLogo size={38} rounded={14} className={`${styles.mobileBrandMark} ${styles.brandMarkLifted}`} />
          <div className={styles.mobileBrandCopy}>
            <h1 className={styles.mobileTitle}>LumeX Fud</h1>
            <p className={styles.mobileMeta}>ABSU, Uturu</p>
          </div>
        </div>
        <button type="button" className={styles.iconButton} aria-label="Search">
          <Search size={16} aria-hidden="true" />
        </button>
      </div>
      <SearchBar />
      <Stories stories={stories} onOpenStory={onOpenStory} />
      <Tabs tabs={tabs} onSelectTab={onSelectTab} />
    </header>
  )
}

function Timeline({
  posts,
  menuOpenFor,
  isActionPending,
  onToggleMenu,
  onLike,
  onReply,
  onRepost,
  onQuote,
  onSave,
  onShare,
  onFollow,
  onReport,
  onNotInterested,
  onHideCreator,
  onMute,
  onBlock,
  onOpenPost,
  followOverrides,
  likedIds,
  savedIds,
  repostedIds,
}: TimelineProps & {
  onOpenPost: (post: FeedV2Post) => void
  followOverrides?: Record<string, boolean>
  likedIds?: string[]
  savedIds?: string[]
  repostedIds?: string[]
}) {
  return (
    <div className={styles.timeline}>
      {posts.map((post, index) => {
        const official = isOfficial(post)
        const toneClass =
          post.kind === 'text'
            ? styles.postDense
            : post.kind === 'official'
              ? styles.postOfficial
              : post.kind === 'menu'
                ? styles.postMenu
                : post.kind === 'collection'
                  ? styles.postCollection
                  : styles.postFeature

        return (
          <Reveal key={post.id} className={styles.postReveal}>
            <article
              id={post.id}
              data-feed-post-id={post.id}
              className={`${styles.post} ${toneClass} ${official ? styles.postOfficial : ''}`}
              onClick={() => onOpenPost(post)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenPost(post)
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Open ${post.author} post ${index + 1}`}
            >
              <PostHeader
                post={post}
                onToggleMenu={onToggleMenu}
                onFollow={onFollow}
                followingAuthor={post.authorProfileId ? followOverrides?.[post.authorProfileId] ?? post.viewerFollows : post.viewerFollows}
                followPending={isActionPending?.(post.id, 'follow')}
              />
              <div className={styles.postContent}>
                <PostBody post={post} onDoubleTapLike={onLike} />
                {post.kind === 'official' && post.ctaLabel ? (
                  <div className={styles.officialFooter}>
                    <button type="button" className={styles.officialCta} onClick={(event) => { event.stopPropagation(); onOpenPost(post) }}>
                      {post.ctaLabel}
                    </button>
                    <span className={styles.officialSubcopy}>Helpful campus update, built for quick action.</span>
                  </div>
                ) : null}
              </div>
              <ActionRow
                post={post}
                isActionPending={isActionPending}
                liked={likedIds?.includes(post.id)}
                saved={savedIds?.includes(post.id)}
                reposted={repostedIds?.includes(post.id)}
                onLike={onLike}
                onReply={onReply}
                onRepost={onRepost}
                onSave={onSave}
                onShare={onShare}
                onOrderNow={onOpenPost}
              />
              {menuOpenFor === post.id ? (
                <PostMenu
                  post={post}
                  isActionPending={isActionPending}
                  onFollow={onFollow}
                  followingAuthor={post.authorProfileId ? followOverrides?.[post.authorProfileId] ?? post.viewerFollows : post.viewerFollows}
                  onQuote={onQuote}
                  onReport={onReport}
                  onNotInterested={onNotInterested}
                  onHideCreator={onHideCreator}
                  onMute={onMute}
                  onBlock={onBlock}
                />
              ) : null}
            </article>
          </Reveal>
        )
      })}
    </div>
  )
}

function BottomNav({ items }: { items: FeedV2LeftNavItem[] }) {
  const mobileItems = items.slice(0, 5)
  return (
    <nav className={styles.bottomNav} aria-label="Mobile navigation">
      {mobileItems.map((item) => (
        <Link key={item.label} href={item.href} className={`${styles.bottomNavItem} ${item.active ? styles.bottomNavItemActive : ''}`}>
          <LeftNavIcon icon={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  )
}

function StoryViewer({
  stories,
  activeIndex,
  onClose,
  onChangeIndex,
}: {
  stories: FeedV2Story[]
  activeIndex: number | null
  onClose: () => void
  onChangeIndex: (index: number) => void
}) {
  const gestureStartY = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wheelLocked = useRef(false)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (activeIndex === null) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        onChangeIndex((activeIndex - 1 + stories.length) % stories.length)
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        onChangeIndex((activeIndex + 1) % stories.length)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [activeIndex, onChangeIndex, onClose, stories.length])

  useEffect(() => {
    setPaused(false)
  }, [activeIndex])

  if (activeIndex === null || stories.length === 0 || activeIndex >= stories.length) return null

  const story = stories[activeIndex]
  const goNext = () => onChangeIndex((activeIndex + 1) % stories.length)
  const goPrev = () => onChangeIndex((activeIndex - 1 + stories.length) % stories.length)
  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
      setPaused(false)
    } else {
      video.pause()
      setPaused(true)
    }
  }

  return (
    <div
      className={styles.storyViewerScrim}
      role="dialog"
      aria-modal="true"
      aria-label={`${story.label} story viewer`}
      onClick={onClose}
    >
      <div
        className={styles.storyViewer}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          gestureStartY.current = event.clientY
        }}
        onPointerUp={(event) => {
          if (gestureStartY.current === null) return
          const delta = event.clientY - gestureStartY.current
          if (Math.abs(delta) > 48) {
            if (delta < 0) goNext()
            else goPrev()
          }
          gestureStartY.current = null
        }}
        onPointerCancel={() => {
          gestureStartY.current = null
        }}
        onWheel={(event) => {
          if (wheelLocked.current || Math.abs(event.deltaY) < 36) return
          wheelLocked.current = true
          if (event.deltaY > 0) goNext()
          else goPrev()
          window.setTimeout(() => { wheelLocked.current = false }, 420)
        }}
      >
        <div key={`${story.label}-${activeIndex}`} className={styles.storyViewerInner}>
          <div className={styles.storyViewerMedia}>
            {story.image ? (
              story.mediaKind === 'video' ? (
                <video
                  ref={videoRef}
                  src={story.image}
                  className={styles.storyViewerVideo}
                  autoPlay
                  muted={muted}
                  playsInline
                  preload="metadata"
                  onEnded={goNext}
                  onPlay={() => setPaused(false)}
                  onPause={() => setPaused(true)}
                  onClick={togglePlayback}
                />
              ) : (
                <Image src={story.image} alt={story.label} fill sizes="100vw" className="object-cover" priority />
              )
            ) : (
              <div className={styles.storyViewerTextOnly}>
                <p>{story.text}</p>
              </div>
            )}
            <div className={styles.storyViewerOverlay} />
          </div>
          <div className={styles.storyViewerProgress} aria-hidden="true">
            {stories.map((_, index) => <span key={index} className={index <= activeIndex ? styles.storyViewerProgressActive : ''} />)}
          </div>
          <div className={styles.storyViewerTopBar}>
            <span className={styles.storyViewerCount}>{activeIndex + 1} / {stories.length}</span>
            <button type="button" className={styles.storyViewerClose} onClick={onClose} aria-label="Close stories"><X size={20} aria-hidden="true" /></button>
          </div>
          {story.mediaKind === 'video' ? <button type="button" className={styles.storyViewerPlayState} onClick={togglePlayback} aria-label={paused ? 'Play story' : 'Pause story'}>{paused ? <Play size={24} fill="currentColor" /> : null}</button> : null}
          <div className={styles.storyViewerSideActions}>
            {story.mediaKind === 'video' ? <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute story' : 'Mute story'}>{muted ? <VolumeX size={21} /> : <Volume2 size={21} />}<span>{muted ? 'Sound' : 'Mute'}</span></button> : null}
            {story.mediaKind === 'video' ? <button type="button" onClick={togglePlayback} aria-label={paused ? 'Play story' : 'Pause story'}>{paused ? <Play size={21} /> : <Pause size={21} />}<span>{paused ? 'Play' : 'Pause'}</span></button> : null}
            <button type="button" onClick={goPrev} aria-label="Previous story"><ArrowRight size={20} style={{ transform: 'rotate(-90deg)' }} /><span>Previous</span></button>
            <button type="button" onClick={goNext} aria-label="Next story"><ArrowRight size={20} style={{ transform: 'rotate(90deg)' }} /><span>Next</span></button>
          </div>
          <div className={styles.storyViewerFooter}>
            <div className={styles.storyViewerIdentity}>
              <span className={styles.storyViewerAvatar}>
                {story.publisherType === 'lumex' ? <BrandLogo size={42} rounded={9999} /> : story.avatarUrl ? <Image src={story.avatarUrl} alt="" fill sizes="42px" className="object-cover" /> : <DefaultAvatar size={16} />}
              </span>
              <div><h3 className={styles.storyViewerTitle}>{story.label}</h3><p className={styles.storyViewerMeta}>{story.meta}</p></div>
            </div>
            {story.text ? <p className={styles.storyViewerCaption}>{story.text}</p> : null}
            <div className={styles.storyViewerStatus}><span className={styles.storyViewerRole}>{storyRoleLabel(story)}</span>{story.approvalState === 'pending' ? <span className={styles.storyViewerPending}>Pending review</span> : null}</div>
            <p className={styles.storyViewerHint}>Swipe up for next story</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function CommentSheet({
  post,
  comments,
  draft,
  loading,
  submitting,
  error,
  onDraftChange,
  onSubmit,
  onClose,
}: {
  post: FeedV2Post | null
  comments: FeedComment[]
  draft: string
  loading: boolean
  submitting: boolean
  error: string
  onDraftChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}) {
  if (!post) return null
  return (
    <div className={`${styles.sheetScrim} ${styles.sheetScrimVisible}`} onClick={onClose}>
      <div className={styles.commentSheet} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Comments on ${post.author} post`}>
        <div className={styles.sheetHandle} />
        <div className={styles.sheetHeader}>
          <div>
            <p className={styles.sectionKicker}>Comments</p>
            <h3 className={styles.sheetTitle}>{post.author}</h3>
            <p className={styles.sheetMeta}>{formatActionCount(post.replyCount)} comments</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close comments">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.commentList}>
          {loading ? <p className={styles.commentEmpty}>Loading comments...</p> : null}
          {!loading && comments.length === 0 ? <p className={styles.commentEmpty}>No comments yet. Be the first to reply.</p> : null}
          {comments.map((comment) => (
            <article key={comment.id} className={styles.commentItem}>
              <Link href={`/feed-v2/profile/${comment.profileId}`} className={styles.commentAvatar} onClick={onClose}>
                {comment.avatarUrl ? <Image src={comment.avatarUrl} alt="" fill sizes="36px" className="object-cover" /> : <DefaultAvatar className={styles.avatarFallback} />}
              </Link>
              <div className={styles.commentCopy}>
                <div className={styles.commentMeta}>
                  <Link href={`/feed-v2/profile/${comment.profileId}`} onClick={onClose}><strong>{comment.author}</strong></Link>
                  {comment.handle ? <span>@{comment.handle}</span> : null}
                  <time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time>
                </div>
                <p>{comment.body}</p>
                <div className={styles.commentActions}>
                  <span><Heart size={13} /> {comment.likeCount || 'Like'}</span>
                  {comment.replyCount > 0 ? <span>{comment.replyCount} replies</span> : <span>Reply</span>}
                </div>
              </div>
            </article>
          ))}
        </div>

        <form className={styles.commentComposer} onSubmit={onSubmit}>
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={2}
            maxLength={2000}
            enterKeyHint="send"
            placeholder="Write a comment..."
          />
          {error ? <p className={styles.commentError} role="alert">{error}</p> : null}
          <button type="submit" disabled={submitting || !draft.trim()}>
            {submitting ? 'Sending...' : 'Reply'}
          </button>
        </form>
      </div>
    </div>
  )
}

function OrderSheet({
  post,
  onClose,
  onLike,
  onReply,
  onRepost,
  onSave,
  onShare,
}: {
  post: FeedV2Post | null
  onClose: () => void
  onLike: (post: FeedV2Post) => void
  onReply: (post: FeedV2Post) => void
  onRepost: (post: FeedV2Post) => void
  onSave: (post: FeedV2Post) => void
  onShare: (post: FeedV2Post) => void
}) {
  const active = Boolean(post)
  if (!post) return null

  const ctaLabel = post.ctaLabel?.trim() || null
  const isOfficialPost = isOfficial(post)
  const sheetPills = post.statusPills ?? (isOfficialPost ? [] : ['Open now', '12min'])

  return (
    <div className={`${styles.sheetScrim} ${active ? styles.sheetScrimVisible : ''}`} onClick={onClose}>
      <div
        className={styles.sheet}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${post.author} ordering sheet`}
      >
        <div className={styles.sheetHandle} />
        <div className={styles.sheetHeader}>
          <div>
            <p className={styles.sectionKicker}>{isOfficialPost ? 'Official update' : 'Ready to order'}</p>
            <h3 className={styles.sheetTitle}>{post.kind === 'official' ? post.title : post.author}</h3>
            <p className={styles.sheetMeta}>{formatMeta(post)}</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close order sheet">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {sheetPills.length > 0 ? (
          <div className={styles.sheetStatus}>
            {sheetPills.slice(0, 3).map((pill) => (
              <span key={pill} className={styles.statusPill} data-tone={statusTone(pill)}>
                {pill}
              </span>
            ))}
          </div>
        ) : null}

        <p className={styles.sheetCopy}>{post.kind === 'official' ? post.officialNote ?? post.body : post.body}</p>

        <div className={styles.sheetActions}>
          <button type="button" className={styles.sheetPrimary} onClick={() => onLike(post)}>
            <Heart size={16} aria-hidden="true" />
            Like
          </button>
          <button type="button" className={styles.sheetSecondary} onClick={() => onReply(post)}>
            <MessageCircle size={16} aria-hidden="true" />
            Comment
          </button>
          <button type="button" className={styles.sheetSecondary} onClick={() => onRepost(post)}>
            <Repeat2 size={16} aria-hidden="true" />
            Repost
          </button>
          <button type="button" className={styles.sheetSecondary} onClick={() => onSave(post)}>
            <Bookmark size={16} aria-hidden="true" />
            Save
          </button>
          <button type="button" className={styles.sheetSecondary} onClick={() => onShare(post)}>
            <Share2 size={16} aria-hidden="true" />
            Share
          </button>
        </div>

        {ctaLabel ? (
          <div className={styles.sheetPrimaryBlock}>
            <div>
              <p className={styles.sheetBlockTitle}>{ctaLabel}</p>
              <p className={styles.sheetBlockMeta}>
                {isOfficialPost ? 'See live vendors currently open around campus.' : 'Fast ordering, warm campus delivery, and clean handoff.'}
              </p>
            </div>
            <button type="button" className={styles.orderButtonLarge} onClick={onClose}>
              <span>{ctaLabel}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function FeedV2Screen({
  posts,
  stories,
  tabs,
  leftNav,
  rightRail,
  ...timelineProps
}: FeedV2ScreenProps) {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null)
  const [likedIds, setLikedIds] = useState<string[]>(() => posts.filter((post) => post.viewerLiked).map((post) => post.id))
  const [savedIds, setSavedIds] = useState<string[]>(() => posts.filter((post) => post.viewerSaved).map((post) => post.id))
  const [repostedIds, setRepostedIds] = useState<string[]>(() => posts.filter((post) => post.viewerReposted).map((post) => post.id))
  const [countOverrides, setCountOverrides] = useState<Record<string, Partial<Pick<FeedV2Post, 'likeCount' | 'replyCount' | 'repostCount' | 'saveCount' | 'shareCount'>>>>({})
  const [localMenuOpenFor, setLocalMenuOpenFor] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<Array<{ postId: string; kind: string }>>([])
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({})
  const [commentPostId, setCommentPostId] = useState<string | null>(null)
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, FeedComment[]>>({})
  const [commentDraft, setCommentDraft] = useState('')
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const screenRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)

  const menuOpenFor = timelineProps.menuOpenFor ?? localMenuOpenFor

  const visiblePosts = posts.map((post) => ({ ...post, ...(countOverrides[post.id] ?? {}) }))
  const selectedPost = visiblePosts.find((post) => post.id === selectedPostId) ?? null
  const commentPost = visiblePosts.find((post) => post.id === commentPostId) ?? null

  const adjustCount = (postId: string, key: 'likeCount' | 'replyCount' | 'repostCount' | 'saveCount' | 'shareCount', delta: number) => {
    const base = visiblePosts.find((post) => post.id === postId)?.[key] ?? 0
    setCountOverrides((current) => ({
      ...current,
      [postId]: {
        ...(current[postId] ?? {}),
        [key]: Math.max(0, base + delta),
      },
    }))
  }

  const isPending = (postId: string, kind: string) => {
    return Boolean(timelineProps.isActionPending?.(postId, kind) || pendingActions.some((item) => item.postId === postId && item.kind === kind))
  }

  const runToggle = async (
    post: FeedV2Post,
    kind: 'like' | 'save' | 'repost',
    enabled: boolean,
    endpoint: string,
  ): Promise<Record<string, unknown>> => {
    setPendingActions((current) => [...current, { postId: post.id, kind }])
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update this post')
      return data
    } finally {
      setPendingActions((current) => current.filter((item) => !(item.postId === post.id && item.kind === kind)))
    }
  }

  const handleLike = async (post: FeedV2Post) => {
    const next = !likedIds.includes(post.id)
    setLikedIds((current) => (next ? [...current, post.id] : current.filter((id) => id !== post.id)))
    adjustCount(post.id, 'likeCount', next ? 1 : -1)
    timelineProps.onLike?.(post)
    if (!timelineProps.onLike) {
      try {
        await runToggle(post, 'like', next, `/api/feed/posts/${post.id}/like`)
      } catch {
        setLikedIds((current) => (next ? current.filter((id) => id !== post.id) : [...current, post.id]))
        adjustCount(post.id, 'likeCount', next ? -1 : 1)
      }
    }
  }

  const handleOpenPost = (post: FeedV2Post) => {
    setSelectedPostId(post.id)
  }

  const handleOpenStory = (index: number) => {
    setSelectedStoryIndex(index)
  }

  const handleToggleMenu = (post: FeedV2Post) => {
    if (timelineProps.onToggleMenu) {
      timelineProps.onToggleMenu(post)
      return
    }
    setLocalMenuOpenFor((current) => (current === post.id ? null : post.id))
  }

  const handleFollow = async (post: FeedV2Post) => {
    if (timelineProps.onFollow) {
      timelineProps.onFollow(post)
      return
    }
    if (!post.authorProfileId) return
    const profileId = post.authorProfileId
    const next = !(followOverrides[profileId] ?? post.viewerFollows)
    setFollowOverrides((current) => ({ ...current, [profileId]: next }))
    setPendingActions((current) => [...current, { postId: post.id, kind: 'follow' }])
    try {
      const res = await fetch(`/api/feed/profiles/${profileId}/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error('Could not update follow')
      setLocalMenuOpenFor(null)
    } catch {
      setFollowOverrides((current) => ({ ...current, [profileId]: !next }))
    } finally {
      setPendingActions((current) => current.filter((item) => !(item.postId === post.id && item.kind === 'follow')))
    }
  }

  const handleSave = async (post: FeedV2Post) => {
    if (timelineProps.onSave) {
      timelineProps.onSave(post)
      return
    }
    const next = !savedIds.includes(post.id)
    setSavedIds((current) => (next ? [...current, post.id] : current.filter((id) => id !== post.id)))
    adjustCount(post.id, 'saveCount', next ? 1 : -1)
    try {
      await runToggle(post, 'save', next, `/api/feed/posts/${post.id}/bookmark`)
    } catch {
      setSavedIds((current) => (next ? current.filter((id) => id !== post.id) : [...current, post.id]))
      adjustCount(post.id, 'saveCount', next ? -1 : 1)
    }
  }

  const handleRepost = async (post: FeedV2Post) => {
    if (timelineProps.onRepost) {
      timelineProps.onRepost(post)
      return
    }
    const next = !repostedIds.includes(post.id)
    setRepostedIds((current) => (next ? [...current, post.id] : current.filter((id) => id !== post.id)))
    adjustCount(post.id, 'repostCount', next ? 1 : -1)
    try {
      const result = await runToggle(post, 'repost', next, `/api/feed/posts/${post.id}/repost`)
      if (typeof result.repostCount === 'number') {
        setCountOverrides((current) => ({
          ...current,
          [post.id]: { ...(current[post.id] ?? {}), repostCount: result.repostCount as number },
        }))
      }
      setActionNotice(next ? 'Reposted' : 'Repost removed')
    } catch (error) {
      setRepostedIds((current) => (next ? current.filter((id) => id !== post.id) : [...current, post.id]))
      adjustCount(post.id, 'repostCount', next ? -1 : 1)
      setActionNotice(error instanceof Error ? error.message : 'Could not repost')
    }
  }

  const loadComments = async (postId: string) => {
    setCommentsLoading(true)
    setCommentError('')
    try {
      const res = await fetch(`/api/feed/posts/${postId}/reply`)
      const data = await res.json().catch(() => ({})) as { comments?: FeedComment[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not load comments')
      setCommentsByPostId((current) => ({ ...current, [postId]: data.comments ?? [] }))
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Could not load comments')
    } finally {
      setCommentsLoading(false)
    }
  }

  const handleReply = (post: FeedV2Post) => {
    if (timelineProps.onReply) {
      timelineProps.onReply(post)
      return
    }
    setCommentPostId(post.id)
    setCommentDraft('')
    setCommentError('')
    void loadComments(post.id)
  }

  const handleShare = async (post: FeedV2Post) => {
    const url = `${window.location.origin}/feed-v2#${post.id}`
    timelineProps.onShare?.(post)
    adjustCount(post.id, 'shareCount', 1)
    void recordFeedEvent(post.id, 'share')
    if (navigator.share) {
      await navigator.share({ title: `${post.author} on LumeX Fud`, text: post.body, url }).catch(() => {})
      return
    }
    await navigator.clipboard?.writeText(url).catch(() => {})
  }

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!commentPost || !commentDraft.trim()) return
    const body = commentDraft.trim()
    setCommentError('')
    setPendingActions((current) => [...current, { postId: commentPost.id, kind: 'reply' }])
    try {
      const res = await fetch(`/api/feed/posts/${commentPost.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; replyCount?: number }
      if (!res.ok) throw new Error(data.error ?? 'Could not comment')
      setCommentDraft('')
      if (typeof data.replyCount === 'number') {
        setCountOverrides((current) => ({
          ...current,
          [commentPost.id]: { ...(current[commentPost.id] ?? {}), replyCount: data.replyCount as number },
        }))
      } else {
        adjustCount(commentPost.id, 'replyCount', 1)
      }
      await loadComments(commentPost.id)
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Could not comment')
    } finally {
      setPendingActions((current) => current.filter((item) => !(item.postId === commentPost.id && item.kind === 'reply')))
    }
  }

  useEffect(() => {
    if (!actionNotice) return
    const timeout = window.setTimeout(() => setActionNotice(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [actionNotice])

  useEffect(() => {
    if (!commentPostId) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [commentPostId])

  useEffect(() => {
    if (!selectedPostId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPostId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPostId])

  useEffect(() => {
    if (selectedStoryIndex === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedStoryIndex(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedStoryIndex])

  useEffect(() => {
    const root = screenRef.current
    const header = headerRef.current
    if (!root || !header) return
    if (typeof window === 'undefined' || !('ResizeObserver' in window)) return

    const setHeaderHeight = () => {
      root.style.setProperty('--fv2-header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`)
    }

    setHeaderHeight()
    const observer = new ResizeObserver(setHeaderHeight)
    observer.observe(header)
    window.addEventListener('resize', setHeaderHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', setHeaderHeight)
    }
  }, [])

  useEffect(() => {
    const root = screenRef.current
    if (!root || typeof window === 'undefined' || !('IntersectionObserver' in window)) return
    const seen = new Set<string>()
    const dwellTimers = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const postId = (entry.target as HTMLElement).dataset.feedPostId
          if (!postId || seen.has(postId)) continue
          if (!entry.isIntersecting || entry.intersectionRatio < 0.55) {
            const timer = dwellTimers.get(postId)
            if (timer) window.clearTimeout(timer)
            dwellTimers.delete(postId)
            continue
          }
          if (dwellTimers.has(postId)) continue
          dwellTimers.set(postId, window.setTimeout(() => {
            seen.add(postId)
            dwellTimers.delete(postId)
            void recordFeedEvent(postId, 'qualified_impression')
            observer.unobserve(entry.target)
          }, 2000))
        }
      },
      { threshold: [0.55] },
    )

    const nodes = root.querySelectorAll<HTMLElement>('[data-feed-post-id]')
    nodes.forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      dwellTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [posts])

  return (
    <div ref={screenRef} className={styles.screen}>
      <div className={styles.shell}>
        <Header tabs={tabs} stories={stories} onSelectTab={timelineProps.onSelectTab} onOpenStory={handleOpenStory} headerRef={headerRef} />
        <div className={styles.grid}>
          <LeftRail items={leftNav} />
          <main className={styles.center}>
            <Timeline
              posts={visiblePosts}
              {...timelineProps}
              menuOpenFor={menuOpenFor}
              isActionPending={isPending}
              onToggleMenu={handleToggleMenu}
              onFollow={handleFollow}
              onLike={handleLike}
              onReply={handleReply}
              onRepost={handleRepost}
              onSave={handleSave}
              onShare={handleShare}
              onOpenPost={handleOpenPost}
              followOverrides={followOverrides}
              likedIds={likedIds}
              savedIds={savedIds}
              repostedIds={repostedIds}
            />
          </main>
          <RightRail rightRail={rightRail} />
        </div>
        <BottomNav items={leftNav} />

        <div className={styles.desktopSheetHost}>
          <OrderSheet
            post={selectedPost}
            onClose={() => setSelectedPostId(null)}
            onLike={handleLike}
            onReply={handleReply}
            onRepost={handleRepost}
            onSave={handleSave}
            onShare={handleShare}
          />
        </div>

        <StoryViewer
          stories={stories}
          activeIndex={selectedStoryIndex}
          onClose={() => setSelectedStoryIndex(null)}
          onChangeIndex={setSelectedStoryIndex}
        />

        <CommentSheet
          post={commentPost}
          comments={commentPost ? commentsByPostId[commentPost.id] ?? [] : []}
          draft={commentDraft}
          loading={commentsLoading}
          submitting={Boolean(commentPost && isPending(commentPost.id, 'reply'))}
          error={commentError}
          onDraftChange={setCommentDraft}
          onSubmit={submitComment}
          onClose={() => {
            setCommentPostId(null)
            setCommentDraft('')
            setCommentError('')
          }}
        />

        {actionNotice ? <div className={styles.actionNotice} role="status">{actionNotice}</div> : null}

        <div className={styles.likeTray} aria-hidden="true">
          {likedIds.slice(-1).map((id) => (
            <span key={id} className={styles.likeBurst}>
              <Heart size={14} fill="currentColor" />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

