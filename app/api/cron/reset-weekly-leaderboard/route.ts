import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'

// Called Monday midnight by Vercel cron (vercel.json: "0 0 * * 1").
// The MVP leaderboard ranks customers by COMPLETED orders (no XP — that
// system was removed). It is computed live from the orders table over a
// rolling 7-day window, so there is no counter to physically "reset" —
// the window simply rolls forward. This cron's job is to congratulate the
// top 3 of the week that just ended via WhatsApp.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'

  // Completed orders in the past week, attributed to a customer. Paginate:
  // a single PostgREST response caps at 1000 rows, which a busy week exceeds.
  const PAGE = 1000
  const counts = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('orders')
      .select('customer_id')
      .eq('status', 'COMPLETED')
      .gte('completed_at', sevenDaysAgo)
      .not('customer_id', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[cron/reset-weekly-leaderboard] DB error:', error.message)
      return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
    }
    const batch = (data ?? []) as Array<{ customer_id: string }>
    for (const o of batch) {
      counts.set(o.customer_id, (counts.get(o.customer_id) ?? 0) + 1)
    }
    if (batch.length < PAGE) break
  }

  const top3 = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  if (top3.length === 0) {
    return NextResponse.json({ notified: 0 })
  }

  // Fetch phones for the winners.
  const { data: customers } = await db
    .from('customers')
    .select('id, phone')
    .in('id', top3.map(([id]) => id))
    .is('deleted_at', null)
  const phoneById = new Map(
    ((customers ?? []) as Array<{ id: string; phone: string }>).map((c) => [c.id, c.phone])
  )

  let notified = 0
  for (let i = 0; i < top3.length; i++) {
    const [customerId, orderCount] = top3[i]
    const phone = phoneById.get(customerId)
    if (!phone) continue
    sendWhatsAppWithFallback({
      to: phone,
      message: renderTemplate('WEEKLY_LEADERBOARD_TOP_3', {
        rank:    i + 1,
        orders:  orderCount,
        app_url: appUrl,
      }),
    }).catch(() => {})
    notified++
  }

  return NextResponse.json({ notified, top: top3.length })
}
