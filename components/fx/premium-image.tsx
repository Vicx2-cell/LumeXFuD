'use client'

import Image from 'next/image'
import { useState, type CSSProperties } from 'react'

interface PremiumImageProps {
  src: string
  alt: string
  /** Fill the (sized) frame — set the frame's size via frameClassName. */
  fill?: boolean
  width?: number
  height?: number
  sizes?: string
  priority?: boolean
  quality?: number
  /** Classes on the <Image> element. */
  className?: string
  /** Classes on the wrapping frame (set aspect/size/rounding here). */
  frameClassName?: string
  style?: CSSProperties
}

/**
 * Premium image treatment for the app's real (functional) imagery — vendor
 * photos, food thumbnails, avatars. A shimmer skeleton holds the space, then on
 * load the photo eases up from a slight scale (clip-free reveal), and hover adds
 * a subtle zoom (desktop). The $10k tell is that nothing ever "pops" in: space
 * is reserved, it shimmers, then resolves. Reduced-motion → a plain quick fade.
 *
 * Drop-in around next/image: pass `fill` + a sized `frameClassName`, or
 * width/height. onError also clears the shimmer so a broken src never shimmers
 * forever.
 */
export function PremiumImage({
  src,
  alt,
  fill,
  width,
  height,
  sizes,
  priority,
  quality,
  className = '',
  frameClassName = '',
  style,
}: PremiumImageProps) {
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={`lx-img ${frameClassName}`} style={style}>
      <span className={`lx-img-shimmer${loaded ? ' lx-img-shimmer--gone' : ''}`} aria-hidden="true" />
      <Image
        src={src}
        alt={alt}
        fill={fill}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        quality={quality}
        className={`lx-img-el${loaded ? ' lx-img-el--in' : ''} ${className}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </span>
  )
}
