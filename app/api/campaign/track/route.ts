import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const input = z.object({
  eventId: z.string().min(8).max(120),
  campaignId: z.string().min(1).max(200),
  vendorId: z.string().uuid(),
  userId: z.string().uuid().optional().nullable(),
  sessionId: z.string().min(8).max(120),
  eventType: z.enum([
    'marketplace_campaign_impression',
    'marketplace_campaign_click',
    'vendor_profile_opened',
    'menu_item_opened',
    'item_added_to_cart',
    'checkout_started',
    'order_completed',
  ]),
  source: z.enum(['marketplace', 'vendor', 'menu', 'cart', 'checkout', 'order']),
  placement: z.string().min(1).max(120),
  targetType: z.string().max(120).optional().default(''),
  targetId: z.string().max(200).optional().default(''),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser().catch(() => null)
  const body = await req.json().catch(() => null)
  const parsed = input.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  await db.from('campaign_events').upsert({
    event_id: parsed.data.eventId,
    campaign_id: parsed.data.campaignId,
    vendor_id: parsed.data.vendorId,
    user_id: session?.userId ?? parsed.data.userId ?? null,
    session_id: parsed.data.sessionId,
    event_type: parsed.data.eventType,
    source: parsed.data.source,
    placement: parsed.data.placement,
    target_type: parsed.data.targetType ?? '',
    target_id: parsed.data.targetId ?? '',
    metadata: parsed.data.metadata ?? {},
    created_at: now,
  }, { onConflict: 'event_id', ignoreDuplicates: true })

  return NextResponse.json({ success: true })
}
