'use client'

const STORAGE_KEY = 'lx_feed_commerce_source'
const SOURCE_TTL_MS = 72 * 60 * 60 * 1000

type StoredFeedSource = {
  postId: string
  vendorId: string
  recordedAt: number
}

export function rememberFeedCommerceSource(postId: string, vendorId: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ postId, vendorId, recordedAt: Date.now() }))
  } catch {
    // Attribution must never block ordering.
  }
}

function readFeedCommerceSource(vendorId?: string | null): StoredFeedSource | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as StoredFeedSource | null
    if (!parsed?.postId || !parsed.vendorId || Date.now() - parsed.recordedAt > SOURCE_TTL_MS) return null
    if (vendorId && parsed.vendorId !== vendorId) return null
    return parsed
  } catch {
    return null
  }
}

export async function recordFeedCommerceEvent(eventType: 'menu_click' | 'add_to_cart' | 'checkout_start', vendorId?: string | null) {
  const source = readFeedCommerceSource(vendorId)
  if (!source) return
  const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  await fetch('/api/feed/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch_key: `feed-commerce-${eventType}-${nonce}`.slice(0, 120),
      source_tab: 'for_you',
      events: [{
        event_key: `${eventType}-${source.postId}-${nonce}`.slice(0, 120),
        post_id: source.postId,
        event_type: eventType,
        source_tab: 'for_you',
        metadata: { surface: 'commerce', vendor_id: source.vendorId },
      }],
    }),
    keepalive: true,
  }).catch(() => {})
}
