export type CampaignEventType =
  | 'marketplace_campaign_impression'
  | 'marketplace_campaign_click'
  | 'vendor_profile_opened'
  | 'menu_item_opened'
  | 'item_added_to_cart'
  | 'checkout_started'
  | 'order_completed'

export type CampaignTrackInput = {
  campaignId: string
  eventType: CampaignEventType
  vendorId: string
  source: 'marketplace' | 'vendor' | 'menu' | 'cart' | 'checkout' | 'order'
  placement: string
  targetType?: string
  targetId?: string | null
  metadata?: Record<string, unknown>
  userId?: string | null
  sessionId?: string | null
}

const SESSION_KEY = 'lx_campaign_session'

export function getCampaignSessionId() {
  if (typeof window === 'undefined') return ''
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const next = crypto.randomUUID()
    window.sessionStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    return crypto.randomUUID()
  }
}

export function campaignHref(path: string, campaignId?: string | null) {
  if (!campaignId) return path
  const url = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'https://lumexfud.com.ng')
  url.searchParams.set('campaign', campaignId)
  return `${url.pathname}${url.search}`
}

export function trackCampaignEvent(input: CampaignTrackInput) {
  if (typeof window === 'undefined') return
  const body = JSON.stringify({
    ...input,
    eventId: crypto.randomUUID(),
    sessionId: input.sessionId || getCampaignSessionId(),
  })

  if (navigator.sendBeacon) {
    const ok = navigator.sendBeacon('/api/campaign/track', new Blob([body], { type: 'application/json' }))
    if (ok) return
  }

  void fetch('/api/campaign/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}
