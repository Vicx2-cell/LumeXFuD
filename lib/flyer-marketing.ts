import 'server-only'

import crypto from 'node:crypto'
import sharp from 'sharp'
import { createSupabaseAdmin } from './supabase/server'
import { notifyUser } from './notify-user'
import { campaignCopy, selectedMeal, type FlyerCampaignCopy, type FlyerCampaignType, type FlyerMealData, type FlyerVendorData } from '@/components/flyers/flyer-content'

export type FlyerEventType =
  | 'vendor.onboarding_completed'
  | 'menu_item.created'
  | 'promotion.created'
  | 'free_delivery.enabled'
  | 'vendor.premium_activated'
  | 'menu_item.back_in_stock'
  | 'vendor.milestone_reached'
  | 'vendor.reopened'
  | 'scheduled.weekend_campaign'
  | 'scheduled.lunch_campaign'

export type FlyerTemplateChoice = {
  templateId: FlyerCampaignType
  variation: number
  copy: FlyerCampaignCopy
}

export type FlyerMarketingEventInput = {
  eventType: FlyerEventType
  vendorId: string
  sourceEntityId?: string | null
  payload?: Record<string, unknown>
  premium?: boolean
}

type DB = ReturnType<typeof createSupabaseAdmin>

const STORAGE_BUCKET = 'menu-images'

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
}

function tidy(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

function naira(value: unknown): string {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return ''
  return `\u20A6${new Intl.NumberFormat('en-NG').format(num)}`
}

function placeholderDataUri(label: string) {
  const safe = escapeXml(label.slice(0, 24))
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FDF1D8"/>
          <stop offset="100%" stop-color="#F5A623"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="1200" fill="url(#g)"/>
      <circle cx="600" cy="560" r="280" fill="rgba(0,0,0,0.08)"/>
      <text x="600" y="620" text-anchor="middle" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800">${safe}</text>
    </svg>
  `
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function splitBalanced(text: string, maxLines: number, maxChars = 18) {
  const clean = tidy(text).replace(/LumeX Fud/g, 'LumeX\u00A0Fud')
  if (!clean) return []
  const words = clean.split(' ')
  if (words.length <= 1) return [clean]

  let best = [clean]
  let bestScore = Number.POSITIVE_INFINITY

  const score = (lines: string[]) => {
    const lengths = lines.map((line) => line.length)
    const spread = Math.max(...lengths) - Math.min(...lengths)
    const oneWordLines = lines.filter((line) => line.split(' ').length === 1).length
    const longPenalty = lines.some((line) => line.length > maxChars) ? 25 : 0
    return spread + oneWordLines * 6 + longPenalty + lines.length * 2
  }

  const walk = (start: number, linesLeft: number, built: string[]) => {
    if (linesLeft === 1) {
      const lines = [...built, words.slice(start).join(' ')]
      const current = score(lines)
      if (current < bestScore) {
        best = lines
        bestScore = current
      }
      return
    }
    for (let cut = start + 1; cut <= words.length - linesLeft + 1; cut += 1) {
      walk(cut, linesLeft - 1, [...built, words.slice(start, cut).join(' ')])
    }
  }

  for (let count = 1; count <= Math.min(maxLines, words.length); count += 1) walk(0, count, [])
  return best.slice(0, maxLines)
}

function textBlock(lines: string[], x: number, y: number, size: number, fill: string, weight = 800, lineHeight = 1.02, letterSpacing = '-0.04em') {
  return `
    <text x="${x}" y="${y}" fill="${fill}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}" dominant-baseline="hanging">
      ${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : size * lineHeight}">${escapeXml(line)}</tspan>`).join('')}
    </text>
  `
}

type SharpFit = keyof typeof sharp.fit

async function fetchImageDataUri(src: string | null | undefined, width: number, height: number, fit: SharpFit = 'cover') {
  if (!src) return null
  const clean = src.trim()
  if (!clean) return null

  let url = clean
  if (clean.startsWith('/')) url = `${appUrl()}${clean}`
  else if (/^https?:\/\//i.test(clean)) url = clean
  else return null

  const response = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'user-agent': 'LumeX-Fud-Flyer/1.0',
    },
  })
  if (!response.ok) return null
  const buffer = Buffer.from(await response.arrayBuffer())
  const meta = await sharp(buffer).rotate().resize(width, height, { fit, withoutEnlargement: true }).png().toBuffer()
  return `data:image/png;base64,${meta.toString('base64')}`
}

function defaultCopyForMilestone(vendor: FlyerVendorData, milestone: string) {
  const headline = milestone === '100 orders' || milestone === '500 orders'
    ? milestone.toUpperCase()
    : milestone.toUpperCase()
  return {
    headline,
    subheadline: `${vendor.name} is being celebrated on LumeX Fud`,
    cta: 'Explore menu',
  }
}

function mapEventToCampaign(eventType: FlyerEventType): FlyerCampaignType {
  switch (eventType) {
    case 'vendor.onboarding_completed': return 'vendor-launch'
    case 'vendor.reopened': return 'vendor-launch'
    case 'menu_item.created': return 'new-menu-alert'
    case 'promotion.created': return 'discount-promo'
    case 'free_delivery.enabled': return 'free-delivery'
    case 'vendor.premium_activated': return 'brand-ad'
    case 'menu_item.back_in_stock': return 'new-menu-alert'
    case 'vendor.milestone_reached': return 'brand-ad'
    case 'scheduled.weekend_campaign': return 'weekend-promo'
    case 'scheduled.lunch_campaign': return 'meal-deal'
  }
}

function mapEventToSourceType(eventType: FlyerEventType): string {
  switch (eventType) {
    case 'menu_item.created':
    case 'menu_item.back_in_stock':
      return 'menu_item'
    case 'promotion.created':
      return 'promotion'
    default:
      return 'vendor'
  }
}

async function loadVendorContext(db: DB, vendorId: string): Promise<FlyerVendorData & { phone: string | null; isPremium: boolean }> {
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, logo_url, shop_photo_url, city_id, zone_id, is_active, is_premium, phone')
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()

  const { data: zone } = vendor?.zone_id
    ? await db.from('delivery_zones').select('id, name, city_id').eq('id', vendor.zone_id).maybeSingle()
    : { data: null }

  const { data: city } = zone?.city_id
    ? await db.from('cities').select('id, name').eq('id', zone.city_id).maybeSingle()
    : { data: null }

  const { data: mealsRaw } = await db
    .from('menu_items')
    .select('id, name, image_url, price_kobo, sold_today, is_available, deleted_at, updated_at')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
    .limit(12)

  const meals = (mealsRaw ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    image: row.image_url ?? vendor?.shop_photo_url ?? '/premium/hero-food.jpg',
    price: naira(row.price_kobo),
    oldPrice: null,
    discount: null,
  })) as FlyerMealData[]

  const campus = tidy([
    zone?.name ?? '',
    city?.name ? city.name : '',
  ].filter(Boolean).join(' '))

  const mealImages = meals.map((meal) => meal.image).filter(Boolean) as string[]

  return {
    id: vendorId,
    name: vendor?.shop_name ?? 'Vendor',
    logo: vendor?.logo_url ?? null,
    campus: campus || 'ABSU',
    deliveryArea: campus || 'ABSU',
    coverImage: vendor?.shop_photo_url ?? null,
    foodImages: mealImages.length > 0 ? mealImages : ['/premium/hero-food.jpg'],
    meals,
    phone: vendor?.phone ?? null,
    isActive: !!vendor?.is_active,
    isPremium: !!vendor?.is_premium,
  }
}

async function loadMealContext(db: DB, vendorId: string, sourceEntityId?: string | null, payload?: Record<string, unknown>) {
  const mealId = nonEmpty(payload?.mealId) ?? nonEmpty(sourceEntityId)
  const { data: meal } = mealId
    ? await db
      .from('menu_items')
      .select('id, name, image_url, price_kobo')
      .eq('id', mealId)
      .eq('vendor_id', vendorId)
      .is('deleted_at', null)
      .maybeSingle()
    : { data: null }

  if (meal) {
    return {
      id: meal.id,
      name: meal.name,
      image: meal.image_url ?? null,
      price: naira(meal.price_kobo),
      oldPrice: null,
      discount: typeof payload?.discount === 'number' ? payload.discount : null,
    } satisfies FlyerMealData
  }

  const mealName = nonEmpty(payload?.mealName) ?? null
  const mealPrice = nonEmpty(payload?.mealPrice) ?? null
  if (mealName || mealPrice) {
    return {
      id: mealId ?? crypto.randomUUID(),
      name: mealName ?? 'Featured meal',
      image: nonEmpty(payload?.mealImage) ?? '',
      price: mealPrice ?? '',
      oldPrice: null,
      discount: typeof payload?.discount === 'number' ? payload.discount : null,
    } satisfies FlyerMealData
  }

  return null
}

function buildCopy(eventType: FlyerEventType, vendor: FlyerVendorData, meal: FlyerMealData | null, payload?: Record<string, unknown>): FlyerCampaignCopy {
  if (eventType === 'vendor.milestone_reached') {
    const milestone = nonEmpty(payload?.milestoneLabel) ?? nonEmpty(payload?.milestone) ?? 'Milestone reached'
    return defaultCopyForMilestone(vendor, milestone)
  }
  if (eventType === 'vendor.premium_activated') {
    return {
      headline: `${vendor.name} is now a Premium Vendor`,
      subheadline: 'Featured on LumeX Fud',
      cta: 'Explore menu',
    }
  }
  return campaignCopy(mapEventToCampaign(eventType), vendor, meal)
}

function selectTemplate(eventType: FlyerEventType, premium: boolean, variation: number): FlyerCampaignType {
  const base = mapEventToCampaign(eventType)
  if (eventType === 'vendor.premium_activated') return 'brand-ad'
  if (!premium) return base
  const premiumCycle: FlyerCampaignType[] = ['brand-ad', 'weekend-promo', 'campus-campaign']
  return premiumCycle[variation % premiumCycle.length] ?? base
}

function ratioForVariation(variation: number): 'square' | 'status' {
  return variation % 2 === 0 ? 'square' : 'status'
}

function renderPosterSvg(opts: {
  aspect: 'square' | 'status'
  template: FlyerCampaignType
  vendor: FlyerVendorData
  meal: FlyerMealData | null
  copy: FlyerCampaignCopy
  logoDataUri: string | null
  foodDataUri: string | null
  variation: number
}) {
  const width = 1080
  const height = opts.aspect === 'status' ? 1920 : 1080
  const pad = opts.aspect === 'status' ? 80 : 64
  const copyLines = splitBalanced(opts.copy.headline, 3, opts.aspect === 'status' ? 24 : 20)
  const subLines = splitBalanced(opts.copy.subheadline, 2, 30)
  const brand = `LumeX Fud \u00d7 ${opts.vendor.name}`
  const brandLines = splitBalanced(brand, 2, 22)
  const foodData = opts.foodDataUri ?? opts.vendor.coverImage ?? '/premium/hero-food.jpg'
  const logoSize = opts.aspect === 'status' ? 114 : 96
  const price = opts.meal?.price ?? ''
  const discount = opts.meal?.discount ? `${opts.meal.discount}% OFF` : ''

  const bg = {
    square: 'url(#bgSquare)',
    status: 'url(#bgStatus)',
  }[opts.aspect]

  const brandBlock = `
    <g transform="translate(${pad},${pad})">
      <defs>
        <clipPath id="logoMask">
          <circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" />
        </clipPath>
      </defs>
      ${opts.logoDataUri ? `<circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="rgba(255,255,255,0.16)"/>` : ''}
      ${opts.logoDataUri ? `<image href="${opts.logoDataUri}" x="0" y="0" width="${logoSize}" height="${logoSize}" clip-path="url(#logoMask)" preserveAspectRatio="xMidYMid slice" />` : ''}
      <g transform="translate(${logoSize + 24},${Math.round(logoSize * 0.18)})">
        ${textBlock(brandLines, 0, 0, opts.aspect === 'status' ? 34 : 28, '#130F0B', 900, 1.0, '-0.04em')}
        ${textBlock(splitBalanced(opts.vendor.deliveryArea, 2, 20), 0, 56, opts.aspect === 'status' ? 16 : 15, '#130F0B', 700, 1.0, '0.08em')}
      </g>
    </g>
  `

  const ctaY = opts.aspect === 'status' ? height - pad - 90 : height - pad - 82
  const ctaBlock = `
    <g transform="translate(${pad},${ctaY})">
      <rect rx="30" ry="30" width="${opts.aspect === 'status' ? 360 : 320}" height="70" fill="#111111"/>
      <text x="32" y="45" fill="#FBF0DA" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">${escapeXml(opts.copy.cta)}</text>
    </g>
  `

  const badgeText = discount || price
  const badgeBlock = badgeText
    ? `
      <g transform="translate(${opts.aspect === 'status' ? width - pad - 330 : width - pad - 280},${pad + 140})">
        <rect rx="36" ry="36" width="${opts.aspect === 'status' ? 320 : 260}" height="88" fill="#F5A623" stroke="#111111" stroke-width="8"/>
        <text x="${opts.aspect === 'status' ? 160 : 130}" y="56" text-anchor="middle" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="${opts.aspect === 'status' ? 46 : 40}" font-weight="900">${escapeXml(badgeText)}</text>
      </g>
    `
    : ''

  const headlineBlock = `
    <g transform="translate(${pad},${opts.aspect === 'status' ? 430 : 320})">
      ${textBlock(copyLines, 0, 0, opts.aspect === 'status' ? 86 : 72, '#111111', 900, 0.96, '-0.06em')}
      ${subLines.length ? `<g transform="translate(0,${copyLines.length * (opts.aspect === 'status' ? 82 : 70) + 42})">${textBlock(subLines, 0, 0, opts.aspect === 'status' ? 30 : 28, '#2a1d12', 700, 1.08, '-0.02em')}</g>` : ''}
    </g>
  `

  const foodBlock = `
    <g>
      <defs>
        <clipPath id="foodMask">
          ${opts.aspect === 'status'
            ? `<path d="M110 910 C180 760, 410 690, 700 720 C920 742, 980 938, 910 1180 C860 1350, 660 1480, 450 1460 C240 1440, 70 1260, 110 910 Z" />`
            : `<path d="M110 660 C190 500, 420 450, 650 470 C860 490, 960 630, 890 810 C820 990, 580 1070, 350 1040 C180 1018, 85 840, 110 660 Z" />`}
        </clipPath>
      </defs>
      <image href="${foodData}" x="${opts.aspect === 'status' ? 30 : 40}" y="${opts.aspect === 'status' ? 640 : 460}" width="${opts.aspect === 'status' ? 1020 : 980}" height="${opts.aspect === 'status' ? 1040 : 720}" clip-path="url(#foodMask)" preserveAspectRatio="xMidYMid slice" />
    </g>
  `

  const deco = opts.template === 'vendor-launch'
    ? `<circle cx="${width - 180}" cy="${opts.aspect === 'status' ? 360 : 250}" r="120" fill="rgba(245,166,35,0.24)"/><circle cx="${width - 120}" cy="${opts.aspect === 'status' ? 520 : 370}" r="70" fill="rgba(17,17,17,0.08)"/>`
    : opts.template === 'meal-deal'
      ? `<path d="M0 ${opts.aspect === 'status' ? 320 : 240} C220 ${opts.aspect === 'status' ? 260 : 180}, 420 ${opts.aspect === 'status' ? 380 : 300}, 1080 ${opts.aspect === 'status' ? 280 : 220} L1080 0 L0 0 Z" fill="rgba(17,17,17,0.08)"/>`
      : opts.template === 'discount-promo'
        ? `<circle cx="180" cy="${opts.aspect === 'status' ? 380 : 260}" r="110" fill="rgba(245,166,35,0.22)"/><circle cx="290" cy="${opts.aspect === 'status' ? 510 : 360}" r="54" fill="rgba(17,17,17,0.12)"/>`
        : opts.template === 'free-delivery'
          ? `<path d="M-20 ${opts.aspect === 'status' ? 540 : 400} C260 ${opts.aspect === 'status' ? 420 : 300}, 460 ${opts.aspect === 'status' ? 560 : 450}, 1100 ${opts.aspect === 'status' ? 460 : 350} L1100 0 L-20 0 Z" fill="rgba(17,17,17,0.08)"/>`
          : opts.template === 'new-menu-alert'
            ? `<circle cx="${width - 240}" cy="${opts.aspect === 'status' ? 600 : 470}" r="140" fill="rgba(245,166,35,0.20)"/>`
            : opts.template === 'campus-campaign'
              ? `<circle cx="180" cy="${opts.aspect === 'status' ? 1160 : 860}" r="180" fill="rgba(17,17,17,0.08)"/>`
              : opts.template === 'weekend-promo'
                ? `<path d="M0 ${opts.aspect === 'status' ? 1120 : 780} C160 ${opts.aspect === 'status' ? 1020 : 720}, 520 ${opts.aspect === 'status' ? 1080 : 820}, 1080 ${opts.aspect === 'status' ? 960 : 710} L1080 ${height} L0 ${height} Z" fill="rgba(17,17,17,0.08)"/>`
                : `<circle cx="${width - 220}" cy="${opts.aspect === 'status' ? 860 : 650}" r="170" fill="rgba(245,166,35,0.18)"/>`

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bgSquare" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FBF0DA"/>
        <stop offset="55%" stop-color="#F8C86A"/>
        <stop offset="100%" stop-color="#F0A52C"/>
      </linearGradient>
      <linearGradient id="bgStatus" x1="0" y1="0" x2="0.95" y2="1">
        <stop offset="0%" stop-color="#FBF0DA"/>
        <stop offset="48%" stop-color="#F7C55B"/>
        <stop offset="100%" stop-color="#E98E19"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000" flood-opacity="0.20"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="${bg}"/>
    ${deco}
    ${brandBlock}
    ${badgeBlock}
    ${headlineBlock}
    ${foodBlock}
    ${ctaBlock}
    ${opts.template === 'brand-ad' && opts.meal ? `<text x="${width - pad}" y="${height - pad - 32}" text-anchor="end" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">${escapeXml(opts.meal.name)}</text>` : ''}
  </svg>`
}

async function uploadFlyerImage(db: DB, vendorId: string, eventType: FlyerEventType, variation: number, png: Buffer) {
  const path = `flyers/${vendorId}/${eventType}/${Date.now()}-${variation}-${crypto.randomUUID()}.png`
  const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(path, png, {
    upsert: true,
    contentType: 'image/png',
  })
  if (uploadError) throw new Error(uploadError.message)
  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function generateFlyerVariants(db: DB, input: FlyerMarketingEventInput) {
  const idempotencyKey = `${input.eventType}:${input.vendorId}:${input.sourceEntityId ?? ''}`
  const now = new Date().toISOString()

  const { data: existingEvent } = await db
    .from('flyer_events')
    .select('id, status')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existingEvent?.id) {
    const { data: flyers } = await db
      .from('generated_flyers')
      .select('id, flyer_event_id, vendor_id, event_type, campaign_type, source_entity_type, source_entity_id, template_id, variation, aspect_ratio, headline, subheadline, cta, image_url, thumbnail_url, status, is_premium_campaign, is_marketplace_campaign, campaign_started_at, campaign_ends_at, viewed_at, downloaded_at, dismissed_at, shared_at, created_at, updated_at')
      .eq('flyer_event_id', existingEvent.id)
      .order('variation', { ascending: true })
    return { eventId: existingEvent.id, flyers: flyers ?? [], deduped: true }
  }

  const vendor = await loadVendorContext(db, input.vendorId)
  const meal = await loadMealContext(db, input.vendorId, input.sourceEntityId, input.payload) ?? selectedMeal(vendor, nonEmpty(input.payload?.mealId) ?? null)
  const campaignType = mapEventToCampaign(input.eventType)
  const premium = input.premium ?? vendor.isPremium
  const variationCount = premium ? 3 : 1
  const flyers: Array<{ image_url: string; variation: number; template_id: FlyerCampaignType; aspect: 'square' | 'status' }> = []

  const { data: eventRow, error: eventErr } = await db
    .from('flyer_events')
    .insert({
      vendor_id: input.vendorId,
      event_type: input.eventType,
      campaign_type: campaignType,
      source_entity_type: mapEventToSourceType(input.eventType),
      source_entity_id: input.sourceEntityId ?? '',
      idempotency_key: idempotencyKey,
      payload: input.payload ?? {},
      status: 'recorded',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (eventErr || !eventRow) {
    const { data: conflict } = await db.from('flyer_events').select('id').eq('idempotency_key', idempotencyKey).maybeSingle()
    if (conflict?.id) {
      const { data: rows } = await db
        .from('generated_flyers')
        .select('id, flyer_event_id, vendor_id, event_type, campaign_type, source_entity_type, source_entity_id, template_id, variation, aspect_ratio, headline, subheadline, cta, image_url, thumbnail_url, status, is_premium_campaign, is_marketplace_campaign, campaign_started_at, campaign_ends_at, viewed_at, downloaded_at, dismissed_at, shared_at, created_at, updated_at')
        .eq('flyer_event_id', conflict.id)
        .order('variation', { ascending: true })
      return { eventId: conflict.id, flyers: rows ?? [], deduped: true }
    }
    throw new Error(eventErr?.message ?? 'Could not create flyer event')
  }

  const copy = buildCopy(input.eventType, vendor, meal, input.payload)
  const logoDataUri = await fetchImageDataUri(vendor.logo, 200, 200, 'cover') ?? placeholderDataUri(vendor.name)
  const foodDataUri = await fetchImageDataUri(meal?.image ?? vendor.foodImages[0] ?? vendor.coverImage, 1100, 1100, 'cover') ?? placeholderDataUri(meal?.name ?? vendor.name)

  for (let variation = 0; variation < variationCount; variation += 1) {
    const templateId = selectTemplate(input.eventType, premium, variation)
    const aspect = ratioForVariation(variation)
    const svg = renderPosterSvg({
      aspect,
      template: templateId,
      vendor,
      meal,
      copy,
      logoDataUri,
      foodDataUri,
      variation,
    })
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const imageUrl = await uploadFlyerImage(db, input.vendorId, input.eventType, variation, png)
    flyers.push({ image_url: imageUrl, variation, template_id: templateId, aspect })

    const inserted = await db.from('generated_flyers').insert({
      flyer_event_id: eventRow.id,
      vendor_id: input.vendorId,
      event_type: input.eventType,
      campaign_type: campaignType,
      source_entity_type: mapEventToSourceType(input.eventType),
      source_entity_id: input.sourceEntityId ?? '',
      template_id: templateId,
      variation,
      aspect_ratio: aspect,
      headline: copy.headline,
      subheadline: copy.subheadline,
      cta: copy.cta,
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      status: 'ready',
      is_premium_campaign: premium,
      is_marketplace_campaign: input.eventType === 'vendor.onboarding_completed' || input.eventType === 'vendor.premium_activated' || input.eventType === 'vendor.milestone_reached',
      campaign_started_at: now,
      campaign_ends_at: null,
      created_at: now,
      updated_at: now,
    }).select('id').single()

    if (inserted.error || !inserted.data) {
      throw new Error(inserted.error?.message ?? 'Could not create generated flyer')
    }
  }

  await db.from('flyer_events').update({ status: 'generated', updated_at: now }).eq('id', eventRow.id)

  if (vendor.phone) {
    await notifyUser({
      userId: vendor.id,
      userType: 'VENDOR',
      phone: vendor.phone,
      title: 'Your flyer is ready',
      body: 'Share this update with your customers.',
      link: '/vendor-dashboard?tab=marketing',
      inAppOnly: false,
      sms: `Your flyer is ready. Share this update with your customers.`,
    })
  }

  return { eventId: eventRow.id, flyers, deduped: false }
}

async function upsertMetric(db: DB, flyerId: string, vendorId: string, metricType: 'view' | 'download' | 'share' | 'impression' | 'click' | 'menu_visit' | 'order', meta: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  const { data } = await db
    .from('flyer_metrics')
    .select('id, metric_count')
    .eq('flyer_id', flyerId)
    .eq('metric_type', metricType)
    .maybeSingle()

  if (!data) {
    await db.from('flyer_metrics').insert({
      flyer_id: flyerId,
      vendor_id: vendorId,
      metric_type: metricType,
      metric_count: 1,
      first_at: now,
      last_at: now,
      meta,
    })
    return
  }

  await db.from('flyer_metrics').update({
    metric_count: Number(data.metric_count ?? 0) + 1,
    last_at: now,
    meta,
  }).eq('id', data.id)
}

async function loadFlyerOwner(db: DB, flyerId: string) {
  const { data } = await db.from('generated_flyers').select('id, vendor_id').eq('id', flyerId).maybeSingle()
  return data as { id: string; vendor_id: string } | null
}

export async function markFlyerDownloaded(db: DB, flyerId: string) {
  const owner = await loadFlyerOwner(db, flyerId)
  const now = new Date().toISOString()
  await db.from('generated_flyers').update({
    downloaded_at: now,
    updated_at: now,
  }).eq('id', flyerId)
  if (owner) await upsertMetric(db, flyerId, owner.vendor_id, 'download')
}

export async function markFlyerDismissed(db: DB, flyerId: string) {
  const owner = await loadFlyerOwner(db, flyerId)
  const now = new Date().toISOString()
  await db.from('generated_flyers').update({
    dismissed_at: now,
    viewed_at: now,
    status: 'archived',
    updated_at: now,
  }).eq('id', flyerId)
  if (owner) await upsertMetric(db, flyerId, owner.vendor_id, 'view')
}

export async function markFlyerViewed(db: DB, flyerId: string) {
  const owner = await loadFlyerOwner(db, flyerId)
  const now = new Date().toISOString()
  await db.from('generated_flyers').update({
    viewed_at: now,
    updated_at: now,
  }).eq('id', flyerId)
  if (owner) await upsertMetric(db, flyerId, owner.vendor_id, 'view')
}

export async function markFlyerShared(db: DB, flyerId: string) {
  const owner = await loadFlyerOwner(db, flyerId)
  const now = new Date().toISOString()
  await db.from('generated_flyers').update({
    shared_at: now,
    updated_at: now,
  }).eq('id', flyerId)
  if (owner) await upsertMetric(db, flyerId, owner.vendor_id, 'share')
}

export function flyerPopupUrl(flyerId: string) {
  return `${appUrl()}/vendor/marketing/flyers/${encodeURIComponent(flyerId)}`
}
