type VendorScoreRow = { composite_score: number; visibility_tier: string } | null

export interface FeedVendorLike {
  id: string
  shop_name: string
  category?: string | null
  city_id?: string | null
  zone_id?: string | null
  vendor_scores?: VendorScoreRow[] | null
}

export interface VendorFeedSignal {
  impressions?: number
  clicks?: number
  views?: number
  downloads?: number
  shares?: number
  orders?: number
}

function getBaseScore(vendor: FeedVendorLike) {
  return vendor.vendor_scores?.[0]?.composite_score ?? 0
}

function getTier(vendor: FeedVendorLike) {
  return (vendor.vendor_scores?.[0]?.visibility_tier ?? 'STANDARD').toUpperCase()
}

function signalBoost(signal: VendorFeedSignal | undefined) {
  if (!signal) return 0
  const positive =
    (signal.clicks ?? 0) * 0.45 +
    (signal.views ?? 0) * 0.15 +
    (signal.downloads ?? 0) * 0.25 +
    (signal.shares ?? 0) * 0.4 +
    (signal.orders ?? 0) * 0.8
  const repetitionPenalty = (signal.impressions ?? 0) * 0.2
  return Math.min(4, positive) - Math.min(4, repetitionPenalty)
}

export function rankVendorFeed<T extends FeedVendorLike>(
  vendors: T[],
  signals: Map<string, VendorFeedSignal> = new Map(),
): T[] {
  const scored = vendors.map((vendor, index) => {
    const tier = getTier(vendor)
    const signal = signals.get(vendor.id)
    const premiumBias = tier === 'TOP' ? 0.75 : tier === 'LOW' ? -0.75 : 0.35
    const categoryBias = vendor.category ? 0.05 : 0
    return {
      vendor,
      index,
      score: getBaseScore(vendor) + premiumBias + categoryBias + signalBoost(signal),
      tier,
    }
  })

  const premium = scored
    .filter((item) => item.tier === 'TOP')
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const standard = scored
    .filter((item) => item.tier !== 'TOP')
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const ordered: T[] = []
  let premiumIndex = 0
  let standardIndex = 0

  while (premiumIndex < premium.length || standardIndex < standard.length) {
    if (standardIndex < standard.length) {
      ordered.push(standard[standardIndex].vendor)
      standardIndex += 1
    }
    if (premiumIndex < premium.length) {
      ordered.push(premium[premiumIndex].vendor)
      premiumIndex += 1
    }
    if (premiumIndex < premium.length) {
      ordered.push(premium[premiumIndex].vendor)
      premiumIndex += 1
    }
  }

  return ordered
}

export function mapVendorSignals(rows: Array<{ vendor_id: string; event_type: string; count: number }>) {
  const signals = new Map<string, VendorFeedSignal>()
  for (const row of rows) {
    const current = signals.get(row.vendor_id) ?? {}
    switch (row.event_type) {
      case 'marketplace_campaign_impression':
        current.impressions = (current.impressions ?? 0) + row.count
        break
      case 'marketplace_campaign_click':
        current.clicks = (current.clicks ?? 0) + row.count
        break
      case 'flyer_viewed':
        current.views = (current.views ?? 0) + row.count
        break
      case 'flyer_downloaded':
        current.downloads = (current.downloads ?? 0) + row.count
        break
      case 'flyer_shared':
        current.shares = (current.shares ?? 0) + row.count
        break
      case 'order_completed':
        current.orders = (current.orders ?? 0) + row.count
        break
    }
    signals.set(row.vendor_id, current)
  }
  return signals
}
