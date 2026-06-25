import Image from 'next/image'
import { Fragment } from 'react'
import type { CSSProperties } from 'react'

interface ImageMarqueeProps {
  /** Image srcs to scroll (kept verbatim). */
  images: string[]
  /** Seconds for one full loop. Larger = slower. */
  speed?: number
  className?: string
}

/**
 * Infinite horizontal rail of food photos — a continuous, GPU-cheap transform
 * loop (server component, no JS). Adds obvious "alive/premium" motion that reads
 * the same on phones as desktop. The track is duplicated once and translated
 * -50% for a seamless loop; reduced-motion pauses it (global motion rule).
 */
export function ImageMarquee({ images, speed = 42, className = '' }: ImageMarqueeProps) {
  const group = (
    <div className="lx-imarquee-group" aria-hidden="true">
      {images.map((src, i) => (
        <Fragment key={i}>
          <div className="lx-imarquee-item">
            <Image src={src} alt="" width={320} height={210} className="lx-imarquee-img" sizes="320px" />
          </div>
        </Fragment>
      ))}
    </div>
  )
  return (
    <div className={`lx-imarquee ${className}`} role="presentation">
      <div className="lx-imarquee-track" style={{ '--lx-marquee-dur': `${speed}s` } as CSSProperties}>
        {group}
        {group}
      </div>
    </div>
  )
}
