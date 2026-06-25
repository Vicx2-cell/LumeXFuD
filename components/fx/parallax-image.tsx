'use client'

import Image from 'next/image'
import { useRef, type ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

interface ParallaxImageProps {
  src: string
  alt?: string
  /** Frame classes (set the aspect ratio / size here, e.g. "aspect-[4/5]"). */
  className?: string
  sizes?: string
  priority?: boolean
  /** Clip-path wipe the frame open on scroll-in. */
  reveal?: boolean
  /** Overlaid content inside the frame (e.g. a caption). */
  children?: ReactNode
}

/**
 * Premium image treatment: the photo lives in an overflow-hidden frame and is
 * oversized + translated SLOWER than the scroll (masked parallax) — the single
 * biggest "expensive vs amateur" tell. Optionally the frame wipes open with a
 * clip-path inset on scroll-in. Hover adds a subtle zoom (CSS, desktop only).
 *
 * The mover is generously oversized (top:-20%/height:140%) so the ±8 yPercent
 * travel never reveals a frame edge. Parallax is linear (ease:'none'); the wipe
 * uses the brand 'lx-smooth' ease. All motion self-guards reduced-motion.
 */
export function ParallaxImage({
  src,
  alt = '',
  className = '',
  sizes = '(max-width: 768px) 100vw, 50vw',
  priority = false,
  reveal = true,
  children,
}: ParallaxImageProps) {
  const frame = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const f = frame.current
      if (!f || prefersReducedMotion()) return
      const mover = f.querySelector('.lx-px-mover')

      if (mover) {
        gsap.fromTo(
          mover,
          { yPercent: -8 },
          {
            yPercent: 8,
            ease: 'none',
            scrollTrigger: { trigger: f, start: 'top bottom', end: 'bottom top', scrub: true },
          },
        )
      }

      if (reveal) {
        gsap.fromTo(
          f,
          { clipPath: 'inset(100% 0% 0% 0%)' },
          {
            clipPath: 'inset(0% 0% 0% 0%)',
            ease: 'lx-smooth',
            scrollTrigger: { trigger: f, start: 'top 85%', end: 'top 45%', scrub: 1 },
          },
        )
      }
    },
    { scope: frame },
  )

  return (
    <div ref={frame} className={`lx-px ${className}`}>
      <div className="lx-px-mover">
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="lx-px-img" />
      </div>
      {children}
    </div>
  )
}
