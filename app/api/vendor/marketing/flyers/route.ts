import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data } = await db
    .from('generated_flyers')
    .select('id, flyer_event_id, vendor_id, event_type, campaign_type, source_entity_type, source_entity_id, template_id, variation, aspect_ratio, headline, subheadline, cta, image_url, thumbnail_url, status, is_premium_campaign, is_marketplace_campaign, campaign_started_at, campaign_ends_at, viewed_at, downloaded_at, dismissed_at, shared_at, created_at, updated_at')
    .eq('vendor_id', session.userId!)
    .order('created_at', { ascending: false })
    .order('variation', { ascending: true })
    .limit(50)

  const { data: metricRows } = await db
    .from('flyer_metrics')
    .select('flyer_id, metric_type, metric_count, last_at')
    .eq('vendor_id', session.userId!)

  const flyers = (data ?? []) as Array<{
    id: string
    flyer_event_id: string
    vendor_id: string
    event_type: string
    campaign_type: string
    source_entity_type: string
    source_entity_id: string
    template_id: string
    variation: number
    aspect_ratio: 'square' | 'status'
    headline: string
    subheadline: string
    cta: string
    image_url: string
    thumbnail_url: string
    status: string
    is_premium_campaign: boolean
    is_marketplace_campaign: boolean
    campaign_started_at: string | null
    campaign_ends_at: string | null
    viewed_at: string | null
    downloaded_at: string | null
    dismissed_at: string | null
    shared_at: string | null
    created_at: string
    updated_at: string
    metrics?: Record<string, number>
  }>

  const metricMap = new Map<string, Record<string, number>>()
  for (const metric of (metricRows ?? []) as Array<{ flyer_id: string; metric_type: string; metric_count: number }>) {
    const current = metricMap.get(metric.flyer_id) ?? {}
    current[metric.metric_type] = metric.metric_count
    metricMap.set(metric.flyer_id, current)
  }

  const flyersWithMetrics = flyers.map((flyer) => ({
    ...flyer,
    metrics: metricMap.get(flyer.id) ?? {},
  }))

  const popup = flyersWithMetrics.find((flyer) => flyer.status === 'ready' && !flyer.dismissed_at) ?? null
  return NextResponse.json({ flyers: flyersWithMetrics, popup })
}
