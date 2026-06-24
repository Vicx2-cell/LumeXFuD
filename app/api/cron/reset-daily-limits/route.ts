import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'

// Called daily at midnight by Vercel cron (vercel.json: "0 0 * * *").
// Resets menu_items.sold_today back to 0 so per-item daily_limit caps
// apply fresh each day. Order placement checks (sold_today + qty > daily_limit)
// live in /api/orders.
// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('reset-daily-limits', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()

  const { data, error } = await db
    .from('menu_items')
    .update({ sold_today: 0 })
    .gt('sold_today', 0)
    .select('id')

  if (error) {
    console.error('[cron/reset-daily-limits] DB error:', error.message)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  // Auto-restore "sold out for today" dishes whose restore time has passed
  // (migration 078). Runs every midnight alongside the daily-limit reset.
  const { data: restored } = await db
    .from('menu_items')
    .update({ is_available: true, sold_out_until: null })
    .lte('sold_out_until', new Date().toISOString())
    .not('sold_out_until', 'is', null)
    .select('id')

  return NextResponse.json({ reset: data?.length ?? 0, restored: restored?.length ?? 0 })
}
