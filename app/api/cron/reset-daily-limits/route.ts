import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// Called daily at midnight by Vercel cron (vercel.json: "0 0 * * *").
// Resets menu_items.sold_today back to 0 so per-item daily_limit caps
// apply fresh each day. Order placement checks (sold_today + qty > daily_limit)
// live in /api/orders.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

  return NextResponse.json({ reset: data?.length ?? 0 })
}
