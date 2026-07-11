import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { markFlyerDismissed, markFlyerDownloaded, markFlyerShared, markFlyerViewed } from '@/lib/flyer-marketing'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: flyer } = await db
    .from('generated_flyers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!flyer || flyer.vendor_id !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ flyer })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: flyer } = await db
    .from('generated_flyers')
    .select('id, vendor_id')
    .eq('id', id)
    .maybeSingle()

  if (!flyer || flyer.vendor_id !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action === 'view') {
    await markFlyerViewed(db, id)
  } else if (body.action === 'share') {
    await markFlyerShared(db, id)
  } else if (body.action === 'dismiss') {
    await markFlyerDismissed(db, id)
  } else if (body.action === 'download') {
    await markFlyerDownloaded(db, id)
  } else if (body.action === 'archive') {
    await db.from('generated_flyers').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id)
  } else if (body.action === 'expire') {
    await db.from('generated_flyers').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', id)
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: flyer } = await db
    .from('generated_flyers')
    .select('id, vendor_id, event_type, campaign_type, source_entity_id, variation')
    .eq('id', id)
    .maybeSingle()

  if (!flyer || flyer.vendor_id !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: vendor } = await db
    .from('vendors')
    .select('is_premium')
    .eq('id', session.userId!)
    .maybeSingle()

  // Rebuild the flyer by re-running the same event pipeline with the next
  // variation. The original marketing meaning stays identical.
  const { generateFlyerVariants } = await import('@/lib/flyer-marketing')
  await generateFlyerVariants(db, {
    eventType: flyer.event_type as Parameters<typeof generateFlyerVariants>[1]['eventType'],
    vendorId: session.userId!,
    sourceEntityId: `${flyer.source_entity_id || flyer.id}:regen:${Date.now()}`,
    premium: !!vendor?.is_premium,
    payload: {
      regenerate: true,
      originalFlyerId: flyer.id,
    },
  })

  return NextResponse.json({ success: true })
}
