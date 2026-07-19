import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { generateFlyerVariants, type FlyerEventType } from '@/lib/flyer-marketing'

const input = z.object({
  eventType: z.enum([
    'vendor.onboarding_completed',
    'menu_item.created',
    'promotion.created',
    'free_delivery.enabled',
    'vendor.premium_activated',
    'menu_item.back_in_stock',
    'vendor.milestone_reached',
    'vendor.reopened',
    'scheduled.weekend_campaign',
    'scheduled.lunch_campaign',
  ]),
  vendorId: z.string().uuid().optional(),
  sourceEntityId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  premium: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = input.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const vendorId = parsed.data.vendorId ?? session.userId
  if (!vendorId) return NextResponse.json({ error: 'Missing vendorId' }, { status: 400 })
  if (session.role === 'vendor' && vendorId !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const result = await generateFlyerVariants(db, {
    eventType: parsed.data.eventType as FlyerEventType,
    vendorId,
    sourceEntityId: parsed.data.sourceEntityId,
    payload: parsed.data.payload,
    premium: parsed.data.premium,
  })

  return NextResponse.json(result)
}
