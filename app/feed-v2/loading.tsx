import styles from './feed-v2.module.css'

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`${styles.skeletonLine} ${className}`} />
}

export default function LoadingFeedV2() {
  return (
    <div className={styles.screen}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.mobileBrandRow}>
            <div className={styles.mobileBrand}>
              <div className={`${styles.skeletonPill} ${styles.mobileBrandMark}`} />
              <div className={styles.mobileBrandCopy}>
                <SkeletonLine className={styles.skeletonTitle} />
                <SkeletonLine className={styles.skeletonMeta} />
              </div>
            </div>
            <div className={styles.skeletonCircle} />
          </div>
          <div className={styles.searchRow}>
            <div className={styles.skeletonSearch} />
            <div className={styles.skeletonCircle} />
          </div>
          <div className={styles.tabs}>
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className={`${styles.skeletonPill} ${styles.skeletonTab}`} />
            ))}
          </div>
          <div className={styles.storiesShell}>
            <div className={styles.storiesHeader}>
              <div>
                <SkeletonLine className={styles.skeletonTitle} />
                <SkeletonLine className={styles.skeletonMeta} />
              </div>
              <SkeletonLine className={styles.skeletonMeta} />
            </div>
            <div className={styles.storiesRow}>
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={item} className={styles.storyItem}>
                  <div className={`${styles.storyAvatarWrap} ${styles.skeletonPill}`}>
                    <div className={styles.storyAvatar} />
                  </div>
                  <SkeletonLine className={styles.skeletonMeta} />
                  <SkeletonLine className={styles.skeletonMeta} />
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className={styles.grid}>
          <aside className={styles.leftRail} aria-hidden="true">
            <div className={styles.leftRailInner}>
              <div className={styles.skeletonBrand} />
              <div className={styles.skeletonNavStack}>
                <SkeletonLine className={styles.skeletonNavItem} />
                <SkeletonLine className={styles.skeletonNavItem} />
                <SkeletonLine className={styles.skeletonNavItem} />
                <SkeletonLine className={styles.skeletonNavItem} />
                <SkeletonLine className={styles.skeletonNavItem} />
              </div>
            </div>
          </aside>

          <main className={styles.center} aria-hidden="true">
            <div className={styles.timeline}>
              {[1, 2, 3, 4].map((item) => (
                <article key={item} className={styles.post}>
                  <div className={styles.postHeader}>
                    <div className={`${styles.avatar} ${styles.skeletonPill}`} />
                    <div className={styles.postHeaderCopy}>
                      <SkeletonLine className={styles.skeletonAuthor} />
                      <SkeletonLine className={styles.skeletonMeta} />
                    </div>
                    <div className={styles.skeletonCircle} />
                  </div>
                  <div className={styles.postContent}>
                    <SkeletonLine className={styles.skeletonBodyShort} />
                    {item % 2 === 0 ? (
                      <div className={`${styles.skeletonMedia} ${styles.mediaGrid} ${styles.mediaSingle}`} />
                    ) : (
                      <div className={`${styles.skeletonBodyTall} ${styles.mediaGrid} ${styles.mediaSingle}`} />
                    )}
                    <div className={styles.skeletonTagRow}>
                      <div className={styles.skeletonTag} />
                      <div className={styles.skeletonTag} />
                    </div>
                  </div>
                  <div className={styles.actionRow}>
                    <div className={styles.actionCluster}>
                      <div className={styles.skeletonCircle} />
                      <div className={styles.skeletonCircle} />
                      <div className={styles.skeletonCircle} />
                      <div className={styles.skeletonCircle} />
                      <div className={styles.skeletonCircle} />
                    </div>
                    <div className={styles.orderButton} />
                  </div>
                </article>
              ))}
            </div>
          </main>

          <aside className={styles.rightRail} aria-hidden="true">
            <div className={styles.rightRailInner}>
              <div className={styles.railSection}>
                <SkeletonLine className={styles.skeletonRailTitle} />
                <div className={styles.railBody}>
                  <div className={styles.skeletonRailCard} />
                  <div className={styles.skeletonRailCard} />
                  <div className={styles.skeletonRailCard} />
                </div>
              </div>
              <div className={styles.railSection}>
                <SkeletonLine className={styles.skeletonRailTitle} />
                <div className={styles.railBody}>
                  <div className={styles.skeletonRailRow} />
                  <div className={styles.skeletonRailRow} />
                  <div className={styles.skeletonRailRow} />
                </div>
              </div>
            </div>
          </aside>
        </div>

        <nav className={styles.bottomNav} aria-hidden="true">
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className={styles.skeletonBottomItem} />
          ))}
        </nav>
      </div>
    </div>
  )
}
