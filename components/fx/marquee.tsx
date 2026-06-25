import { Fragment, type CSSProperties } from 'react'

interface MarqueeProps {
  /** Phrases shown in the strip (kept verbatim — your words). */
  items: string[]
  /** Seconds for one full loop. Larger = slower. */
  speed?: number
  /** Scroll direction. */
  reverse?: boolean
  className?: string
}

/**
 * Infinite kinetic text strip. Pure CSS transform loop (GPU-cheap, no JS rAF),
 * so it's a server component. The track is duplicated once and translated -50%
 * for a seamless loop; reduced-motion pauses it (the global motion rule kills
 * the animation). A diamond separator sits between phrases.
 */
export function Marquee({ items, speed = 26, reverse = false, className = '' }: MarqueeProps) {
  const group = (
    <div className="lx-marquee-group" aria-hidden="true">
      {items.map((t, i) => (
        <Fragment key={i}>
          <span className="lx-marquee-item">{t}</span>
          <span className="lx-marquee-sep">◆</span>
        </Fragment>
      ))}
    </div>
  )
  return (
    <div className={`lx-marquee ${className}`} role="presentation">
      <div
        className={`lx-marquee-track${reverse ? ' lx-marquee-track--rev' : ''}`}
        style={{ '--lx-marquee-dur': `${speed}s` } as CSSProperties}
      >
        {group}
        {group}
      </div>
    </div>
  )
}
