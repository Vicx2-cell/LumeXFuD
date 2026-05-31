import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/wallet'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'

// Called every 5 minutes by Vercel cron.
// Calls the Postgres release_held_batch() function which atomically:
//   1. Finds HOLD transactions past their release_at
//   2. Moves held → available balance (SELECT FOR UPDATE)
//   3. Marks HOLD as COMPLETED and inserts RELEASE record
// Then sends WhatsApp notifications for each released user.

interface ReleasedItem {
  user_id: string
  user_type: 'VENDOR' | 'RIDER'
  amount: number
  order_id: string | null
}

interface RpcResult {
  released_count: number
  released_data: ReleasedItem[]
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()

  const { data, error } = await db.rpc('release_held_batch')
  if (error) {
    console.error('[cron/wallet-release-held] RPC error:', error.message)
    return NextResponse.json({ error: 'RPC failed', details: error.message }, { status: 500 })
  }

  const result = data as unknown as RpcResult
  const { released_count, released_data } = result

  if (!released_count || released_count === 0) {
    return NextResponse.json({ released: 0 })
  }

  // Send WhatsApp notification to each user whose funds were released
  const notified = new Set<string>()

  for (const item of released_data ?? []) {
    const key = `${item.user_id}:${item.user_type}`
    if (notified.has(key)) continue
    notified.add(key)

    try {
      const table = item.user_type === 'VENDOR' ? 'vendors' : 'riders'
      const { data: ur } = await db.from(table).select('phone').eq('id', item.user_id).maybeSingle()
      const phone = (ur as unknown as { phone?: string } | null)?.phone
      if (phone) {
        sendWhatsAppWithFallback({
          to: phone,
          message: `${formatPrice(item.amount)} is now available for withdrawal in your LumeX Wallet. Tap "Withdraw" in the app.`,
        }).catch(() => {})
      }
    } catch {
      // Non-fatal — funds are released even if notification fails
    }
  }

  return NextResponse.json({ released: released_count })
}
