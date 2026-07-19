'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { FlyerAspect, FlyerCampaign, FlyerTemplateData, FlyerTemplateId } from './types'

const CANVAS = {
  square: { width: 1080, height: 1080, padding: 64 },
  status: { width: 1080, height: 1920, padding: 80 },
} as const

const aspectClass: Record<FlyerAspect, string> = {
  square: 'aspect-square',
  status: 'aspect-[9/16]',
}

export const flyerTemplateOptions: Array<{ value: FlyerTemplateId; label: string }> = [
  { value: 'vendor-launch', label: 'Vendor launch' },
  { value: 'meal-deal', label: 'Meal deal' },
  { value: 'discount-promo', label: 'Discount promo' },
  { value: 'free-delivery', label: 'Free delivery' },
  { value: 'new-menu-alert', label: 'New menu alert' },
  { value: 'campus-campaign', label: 'Campus campaign' },
  { value: 'weekend-promo', label: 'Weekend promo' },
  { value: 'brand-ad', label: 'LumeX brand ad' },
]

export const flyerAspectOptions: Array<{ value: FlyerAspect; label: string }> = [
  { value: 'square', label: 'Instagram square' },
  { value: 'status', label: 'WhatsApp status' },
]

type PosterProps = {
  data: FlyerTemplateData
  aspect: FlyerAspect
  debug: boolean
}

type ZoneProps = {
  label: string
  debug: boolean
  className?: string
  style?: CSSProperties
  children: ReactNode
}

function imageSrc(src: string | null | undefined) {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return `/api/flyer-image?url=${encodeURIComponent(trimmed)}`
  return trimmed
}

function normalizeText(text: string) {
  return text.replace(/LumeX Fud/g, 'LumeX\u00A0Fud').replace(/\s+/g, ' ').trim()
}

function safeText(text: string, fallback: string) {
  return normalizeText(text) || fallback
}

function hasText(text: string) {
  return normalizeText(text).length > 0
}

function splitBalanced(text: string, maxLines: number) {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const words = normalized.split(' ')
  if (words.length === 1) return [normalized]

  let bestLines = [normalized]
  let bestScore = Number.POSITIVE_INFINITY

  const scoreLines = (lines: string[]) => {
    const lengths = lines.map((line) => line.length)
    const max = Math.max(...lengths)
    const min = Math.min(...lengths)
    const singleWordPenalty = lines.some((line) => line.split(' ').length === 1) && words.length > lines.length ? 500 : 0
    const overflowPenalty = lines.some((line) => line.length > 22) ? 120 : 0
    const linePenalty = lines.length * 8
    return max - min + singleWordPenalty + overflowPenalty + linePenalty
  }

  const walk = (start: number, linesLeft: number, built: string[]) => {
    if (linesLeft === 1) {
      const lines = [...built, words.slice(start).join(' ')]
      const score = scoreLines(lines)
      if (score < bestScore) {
        bestScore = score
        bestLines = lines
      }
      return
    }

    for (let index = start + 1; index <= words.length - linesLeft + 1; index += 1) {
      walk(index, linesLeft - 1, [...built, words.slice(start, index).join(' ')])
    }
  }

  for (let count = 1; count <= Math.min(maxLines, words.length); count += 1) {
    walk(0, count, [])
  }

  return bestLines
}

function headlineSize(text: string, aspect: FlyerAspect, mode: 'hero' | 'wide' | 'compact') {
  const count = normalizeText(text).length

  if (mode === 'hero') {
    if (aspect === 'status') {
      if (count > 34) return { fontSize: 86, lineHeight: 0.92 }
      if (count > 24) return { fontSize: 98, lineHeight: 0.9 }
      return { fontSize: 108, lineHeight: 0.88 }
    }
    if (count > 34) return { fontSize: 82, lineHeight: 0.94 }
    if (count > 24) return { fontSize: 92, lineHeight: 0.9 }
    return { fontSize: 102, lineHeight: 0.88 }
  }

  if (mode === 'wide') {
    if (aspect === 'status') {
      if (count > 42) return { fontSize: 72, lineHeight: 0.96 }
      if (count > 28) return { fontSize: 82, lineHeight: 0.94 }
      return { fontSize: 92, lineHeight: 0.9 }
    }
    if (count > 42) return { fontSize: 68, lineHeight: 0.98 }
    if (count > 28) return { fontSize: 76, lineHeight: 0.94 }
    return { fontSize: 88, lineHeight: 0.9 }
  }

  if (aspect === 'status') {
    if (count > 40) return { fontSize: 64, lineHeight: 1 }
    if (count > 28) return { fontSize: 74, lineHeight: 0.96 }
    return { fontSize: 84, lineHeight: 0.92 }
  }

  if (count > 40) return { fontSize: 60, lineHeight: 1 }
  if (count > 28) return { fontSize: 70, lineHeight: 0.96 }
  return { fontSize: 80, lineHeight: 0.92 }
}

function brandFontSize(text: string, aspect: FlyerAspect) {
  const count = normalizeText(text).length
  if (aspect === 'status') {
    if (count > 34) return 28
    if (count > 22) return 32
    return 36
  }
  if (count > 34) return 26
  if (count > 22) return 30
  return 34
}

function campusFontSize(text: string, aspect: FlyerAspect) {
  const count = normalizeText(text).length
  if (aspect === 'status') {
    if (count > 30) return 18
    return 20
  }
  if (count > 30) return 17
  return 19
}

function Zone({ label, debug, className = '', style, children }: ZoneProps) {
  return (
    <div
      data-zone={label}
      className={`relative ${className}`}
      style={{
        ...style,
        boxShadow: debug ? 'inset 0 0 0 4px rgba(255,255,255,0.9)' : undefined,
      }}
    >
      {debug ? (
        <span className="absolute left-3 top-3 z-20 rounded-full bg-black/75 px-3 py-1 text-[16px] font-bold uppercase tracking-[0.18em] text-white">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  )
}

function BrandHeader({ data, aspect, dark = false }: { data: FlyerTemplateData; aspect: FlyerAspect; dark?: boolean }) {
  const logo = imageSrc(data.vendorLogo)
  const brandLines = splitBalanced(data.vendorName === 'LumeX Fud' ? 'LumeX Fud' : `LumeX Fud × ${data.vendorName}`, 2)
  const campusLines = splitBalanced(data.campus, 2)
  const brandSize = brandFontSize(brandLines.join(' '), aspect)
  const campusSize = campusFontSize(campusLines.join(' '), aspect)

  return (
    <div className="grid h-full grid-cols-[1fr_auto] items-start gap-6">
      <div className="grid min-w-0 grid-cols-[72px_1fr] gap-4">
        <div
          className={`grid h-[72px] w-[72px] place-items-center rounded-full text-[24px] font-black shadow-[0_16px_26px_rgba(0,0,0,0.12)] ${
            dark ? 'bg-[#FBF0DA] text-[#17120D]' : 'bg-[#17120D] text-[#FBF0DA]'
          }`}
        >
          LX
        </div>
        <div className="min-w-0">
          <div
            className={`${dark ? 'text-[#FBF0DA]' : 'text-[#17120D]'} font-black tracking-[-0.03em]`}
            style={{ fontSize: `${brandSize}px`, lineHeight: 0.9 }}
          >
            {brandLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </div>
          {campusLines.length ? (
            <div
              className={`mt-3 font-semibold uppercase tracking-[0.16em] ${dark ? 'text-[#FBF0DAB5]' : 'text-[#17120DAA]'}`}
              style={{ fontSize: `${campusSize}px`, lineHeight: 1.1 }}
            >
              {campusLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {logo ? (
        <div className="h-[86px] w-[86px] overflow-hidden rounded-full border-[6px] border-white/45 bg-white/25 shadow-[0_18px_28px_rgba(0,0,0,0.16)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={`${data.vendorName} logo`} className="h-full w-full object-cover" />
        </div>
      ) : null}
    </div>
  )
}

function HeadlineBlock({
  text,
  aspect,
  mode,
  tone,
}: {
  text: string
  aspect: FlyerAspect
  mode: 'hero' | 'wide' | 'compact'
  tone: string
}) {
  const lines = useMemo(() => splitBalanced(text, 3), [text])
  const size = headlineSize(text, aspect, mode)

  return (
    <div className="min-w-[600px] max-w-[820px]">
      <div
        className={`lx-display font-black tracking-[-0.05em] ${tone}`}
        style={{ fontSize: `${size.fontSize}px`, lineHeight: size.lineHeight }}
      >
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </div>
    </div>
  )
}

function BodyCopy({ text, tone, size = 32 }: { text: string; tone: string; size?: number }) {
  if (!hasText(text)) return null
  const lines = splitBalanced(text, 2)

  return (
    <div className={tone} style={{ fontSize: `${size}px`, lineHeight: 1.08, fontWeight: 650 }}>
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </div>
  )
}

function OfferBadge({
  text,
  dark = false,
  rotate = 0,
}: {
  text: string
  dark?: boolean
  rotate?: number
}) {
  if (!hasText(text)) return null

  return (
    <div
      className={`inline-flex self-start rounded-full px-8 py-5 text-[58px] font-black leading-none shadow-[0_20px_32px_rgba(0,0,0,0.16)] ${
        dark ? 'bg-[#17120D] text-[#FBF0DA]' : 'bg-[#FBF0DA] text-[#17120D]'
      }`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {safeText(text, '')}
    </div>
  )
}

function CTAChip({ text, dark = false }: { text: string; dark?: boolean }) {
  return (
    <div
      className={`inline-flex self-start rounded-full px-6 py-3 text-[24px] font-black uppercase tracking-[0.16em] ${
        dark ? 'bg-[#17120D] text-[#FBF0DA]' : 'bg-[#FBF0DA] text-[#17120D]'
      }`}
    >
      {safeText(text, 'Order now')}
    </div>
  )
}

function ImageMask({
  src,
  alt,
  className = '',
  style,
}: {
  src: string | null
  alt: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`} style={style}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover object-center" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-black/8 text-[32px] font-bold text-black/38">Add food image</div>
      )}
    </div>
  )
}

function baseCanvasStyle(aspect: FlyerAspect) {
  const size = CANVAS[aspect]
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
  } satisfies CSSProperties
}

function safeAreaStyle(aspect: FlyerAspect) {
  const { padding } = CANVAS[aspect]
  return {
    inset: `${padding}px`,
  } satisfies CSSProperties
}

function VendorLaunchPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 340px 120px 1fr' : '140px 250px 120px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#FBF0DA_0%,#F5D387_58%,#E4873A_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(255,255,255,0.48),transparent_18%),radial-gradient(circle_at_83%_16%,rgba(255,255,255,0.28),transparent_16%),radial-gradient(circle_at_20%_62%,rgba(241,170,36,0.22),transparent_16%),radial-gradient(circle_at_78%_74%,rgba(217,106,44,0.24),transparent_18%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} />
          </Zone>
          <Zone label="headline" debug={debug} className="flex flex-col justify-start gap-6">
            <HeadlineBlock text={data.headline} aspect={aspect} mode="hero" tone="text-[#17120D]" />
            <BodyCopy text={data.subheadline} tone="text-[#17120DDE]" size={34} />
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <div className="flex flex-col gap-4">
              <BodyCopy text={data.subheadline} tone="text-[#FBF0DABF]" size={30} />
              <CTAChip text={data.cta || 'Order now'} dark />
            </div>
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <ImageMask src={food} alt={data.headline} className="rounded-[44px]" />
          </Zone>
        </div>
      </div>
    </div>
  )
}

function MealDealPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 280px 130px 1fr' : '140px 220px 120px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#1E140E_0%,#2A1A11_50%,#E67C35_50%,#E67C35_100%)]">
      <div className="absolute inset-x-0 bottom-0 h-[44%] bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.16),transparent_22%),radial-gradient(circle_at_80%_35%,rgba(255,255,255,0.12),transparent_20%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} dark />
          </Zone>
          <Zone label="headline" debug={debug} className="grid items-start gap-8" style={{ gridTemplateColumns: '1fr auto' }}>
            <HeadlineBlock text={data.headline} aspect={aspect} mode="hero" tone="text-[#FBF0DA]" />
            {hasText(data.price) ? <OfferBadge text={data.price} rotate={-4} /> : <div />}
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'Order now'} />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <ImageMask src={food} alt={data.headline} className="rounded-[56px_56px_36px_36px]" />
          </Zone>
        </div>
      </div>
    </div>
  )
}

function DiscountPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 170px 260px 120px 1fr' : '140px 150px 220px 110px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#FFF0CC_0%,#F7C752_52%,#ED9630_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_22%,rgba(255,255,255,0.48),transparent_18%),radial-gradient(circle_at_88%_18%,rgba(222,107,45,0.18),transparent_18%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} />
          </Zone>
          <Zone label="offer" debug={debug} className="flex items-start">
            {hasText(data.discount) ? <OfferBadge text={data.discount} dark rotate={-3} /> : null}
          </Zone>
          <Zone label="headline" debug={debug} className="flex flex-col justify-start gap-6">
            <HeadlineBlock text={data.headline} aspect={aspect} mode="compact" tone="text-[#17120D]" />
            <BodyCopy text={data.subheadline} tone="text-[#17120DDE]" size={32} />
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'Claim in app'} dark />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <div className="h-full w-full rounded-[260px_260px_40px_40px] bg-[#FBF0DA]/24 p-5">
              <ImageMask src={food} alt={data.headline} className="rounded-[240px_240px_28px_28px]" />
            </div>
          </Zone>
        </div>
      </div>
    </div>
  )
}

function FreeDeliveryPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 280px 120px 1fr' : '140px 220px 110px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#FBF0DA]">
      <div className="absolute inset-x-0 bottom-0 h-[48%] rounded-t-[180px] bg-[linear-gradient(180deg,#F1AF34_0%,#E47633_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_24%,rgba(241,170,36,0.2),transparent_16%),radial-gradient(circle_at_84%_18%,rgba(23,18,13,0.12),transparent_14%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} />
          </Zone>
          <Zone label="headline" debug={debug} className="flex flex-col justify-start gap-6">
            <HeadlineBlock text={data.headline} aspect={aspect} mode="hero" tone="text-[#17120D]" />
            <BodyCopy text={data.subheadline} tone="text-[#17120DDE]" size={32} />
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'Order now'} dark />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <div className="mx-auto h-full w-full max-w-[820px] overflow-hidden rounded-full bg-[#FBF0DA]/18 p-4">
              <ImageMask src={food} alt={data.headline} className="rounded-full" />
            </div>
          </Zone>
        </div>
      </div>
    </div>
  )
}

function NewMenuPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 260px 160px 120px 1fr' : '140px 210px 140px 110px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#B34A20_0%,#D86A2B_56%,#F0B039_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_20%,rgba(255,255,255,0.16),transparent_18%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} dark />
          </Zone>
          <Zone label="headline" debug={debug} className="grid items-start gap-8" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="rounded-[44px] bg-[#17120D] px-9 py-8 shadow-[0_24px_34px_rgba(0,0,0,0.18)]">
              <HeadlineBlock text={data.headline} aspect={aspect} mode="compact" tone="text-[#FBF0DA]" />
            </div>
            <div className="grid h-[180px] w-[180px] place-items-center rounded-[34px] bg-[#FBF0DA] text-center text-[36px] font-black leading-[0.92] text-[#17120D] shadow-[0_20px_30px_rgba(0,0,0,0.18)]">
              NEW
              <br />
              DROP
            </div>
          </Zone>
          <Zone label="subheadline" debug={debug} className="flex items-start pt-2">
            <BodyCopy text={data.subheadline} tone="text-[#FBF0DABF]" size={30} />
          </Zone>
          <Zone label="offer" debug={debug} className="flex items-start">
            {hasText(data.discount) ? <OfferBadge text={data.discount} /> : null}
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'See menu'} />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <ImageMask src={food} alt={data.headline} className="rounded-[52px]" />
          </Zone>
        </div>
      </div>
    </div>
  )
}

function CampusPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 260px 120px 120px 1fr' : '140px 210px 100px 100px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#FFF2D4_0%,#F5C64F_50%,#E57C34_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.48),transparent_14%),radial-gradient(circle_at_36%_30%,rgba(255,255,255,0.38),transparent_12%),radial-gradient(circle_at_80%_26%,rgba(255,255,255,0.34),transparent_13%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} />
          </Zone>
          <Zone label="headline" debug={debug} className="flex items-start">
            <div className="rounded-[40px] bg-[#17120D] px-9 py-8 text-[#FBF0DA] shadow-[0_24px_34px_rgba(0,0,0,0.16)]">
              <HeadlineBlock text={data.headline} aspect={aspect} mode="wide" tone="text-[#FBF0DA]" />
            </div>
          </Zone>
          <Zone label="offer" debug={debug} className="flex items-start gap-4">
            <div className="rounded-full bg-[#FBF0DA] px-8 py-4 text-[28px] font-black uppercase tracking-[0.14em] text-[#17120D]">ABSU</div>
            <div className="rounded-full bg-[#DE6B2D] px-7 py-4 text-[26px] font-black uppercase tracking-[0.14em] text-[#FBF0DA]">Campus food</div>
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'Order now'} dark />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <ImageMask src={food} alt={data.headline} className="rounded-[170px_170px_34px_34px]" />
          </Zone>
        </div>
      </div>
    </div>
  )
}

function WeekendPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 260px 120px 1fr' : '140px 210px 110px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#17120D_0%,#2A180F_42%,#7B3418_68%,#E47F34_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_28%,rgba(241,170,36,0.14),transparent_18%),radial-gradient(circle_at_86%_18%,rgba(255,255,255,0.1),transparent_14%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} dark />
          </Zone>
          <Zone label="headline" debug={debug} className="flex flex-col justify-start gap-6">
            <div className="rounded-[40px] bg-[#F1AA24] px-8 py-7 shadow-[0_22px_34px_rgba(0,0,0,0.16)]">
              <HeadlineBlock text={data.headline} aspect={aspect} mode="wide" tone="text-[#17120D]" />
            </div>
            <BodyCopy text={data.subheadline} tone="text-[#17120DDE]" size={32} />
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'Start order'} />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <ImageMask src={food} alt={data.headline} className="rounded-[44px]" />
          </Zone>
        </div>
      </div>
    </div>
  )
}

function BrandAdPoster({ data, aspect, debug }: PosterProps) {
  const food = imageSrc(data.foodImage)
  const rows = aspect === 'status' ? '160px 300px 120px 1fr' : '140px 240px 110px 1fr'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,#17120D_0%,#24170F_44%,#F6E0B4_44%,#F0B24A_72%,#E67B34_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(241,170,36,0.18),transparent_16%),radial-gradient(circle_at_82%_16%,rgba(255,255,255,0.12),transparent_14%)]" />
      <div className="absolute" style={safeAreaStyle(aspect)}>
        <div className="grid h-full grid-cols-1 gap-y-10" style={{ gridTemplateRows: rows }}>
          <Zone label="brand" debug={debug}>
            <BrandHeader data={data} aspect={aspect} dark />
          </Zone>
          <Zone label="headline" debug={debug} className="flex flex-col justify-start gap-6">
            <HeadlineBlock text={data.headline} aspect={aspect} mode="wide" tone="text-[#FBF0DA]" />
            <BodyCopy text={data.subheadline} tone="text-[#FBF0DABF]" size={30} />
          </Zone>
          <Zone label="cta" debug={debug} className="flex items-start pt-2">
            <CTAChip text={data.cta || 'Open app'} dark />
          </Zone>
          <Zone label="image" debug={debug} className="min-h-0">
            <ImageMask src={food} alt={data.headline} className="rounded-[52px_52px_34px_34px]" />
          </Zone>
        </div>
      </div>
    </div>
  )
}

function renderPoster(campaign: FlyerCampaign, aspect: FlyerAspect, debug: boolean) {
  const props = { data: campaign.data, aspect, debug }
  switch (campaign.template) {
    case 'vendor-launch':
      return <VendorLaunchPoster {...props} />
    case 'meal-deal':
      return <MealDealPoster {...props} />
    case 'discount-promo':
      return <DiscountPoster {...props} />
    case 'free-delivery':
      return <FreeDeliveryPoster {...props} />
    case 'new-menu-alert':
      return <NewMenuPoster {...props} />
    case 'campus-campaign':
      return <CampusPoster {...props} />
    case 'weekend-promo':
      return <WeekendPoster {...props} />
    case 'brand-ad':
      return <BrandAdPoster {...props} />
  }
}

export function FlyerTemplate({
  campaign,
  aspect,
  className = '',
  exportId,
}: {
  campaign: FlyerCampaign
  aspect: FlyerAspect
  className?: string
  exportId?: string
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [debug] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.get('flyerDebug') === '1'
  })
  const size = CANVAS[aspect]

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const updateScale = () => {
      const width = frame.clientWidth || size.width
      setScale(Math.min(1, width / size.width))
    }

    updateScale()

    const observer = new ResizeObserver(() => updateScale())
    observer.observe(frame)
    return () => observer.disconnect()
  }, [aspect, size.width])

  return (
    <div ref={frameRef} className={`relative w-full ${aspectClass[aspect]} ${className}`}>
      <div
        id={exportId}
        data-flyer-root="true"
        className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[52px] shadow-[0_40px_90px_rgba(0,0,0,0.28)]"
        style={
          {
            ...baseCanvasStyle(aspect),
            transform: `scale(${scale})`,
          } satisfies CSSProperties
        }
      >
        {renderPoster(campaign, aspect, debug)}
      </div>
    </div>
  )
}
