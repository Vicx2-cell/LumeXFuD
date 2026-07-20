import { NextRequest, NextResponse } from 'next/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { processOrderDelay, type SpeedOrder } from '@/lib/order-speed'

export const runtime = 'nodejs'

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('orders')
    .select('id, order_number, status, payment_status, delivery_type, customer_id, vendor_id, rider_id, placed_at, pending_since, promised_delivery_at')
    .eq('payment_status', 'PAID')
    .neq('delivery_type', 'PICKUP')
    .in('status', ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'PICKED_UP'])
    .order('placed_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: 'Could not load active orders' }, { status: 500 })
  const decisions = await Promise.allSettled((data as SpeedOrder[]).map((order) => processOrderDelay(db, order)))
  return NextResponse.json({
    checked: decisions.length,
    delayed: decisions.filter((result) => result.status === 'fulfilled' && result.value.delayed).length,
    failed: decisions.filter((result) => result.status === 'rejected').length,
  })
}

export async function GET(req: NextRequest) { return withCronHealth('order-delay-watch', () => handle(req)) }
export async function POST(req: NextRequest) { return handle(req) }
