import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { unfreezeWallet } from '@/lib/wallet'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'

const schema = z.object({
  user_id:   z.string().uuid(),
  user_type: z.enum(['VENDOR', 'RIDER']),
  reason:    z.string().min(5).max(500),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`wallet-unfreeze:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { user_id, user_type, reason } = parsed.data

  await unfreezeWallet({ userId: user_id, userType: user_type, reason, adminPhone: session.phone })

  // Notify the user via WhatsApp
  const db = createSupabaseAdmin()
  const table = user_type === 'VENDOR' ? 'vendors' : 'riders'
  const { data: ur } = await db.from(table).select('phone').eq('id', user_id).maybeSingle()
  const urCast = ur as unknown as { phone?: string } | null
  if (urCast?.phone) {
    sendWhatsAppWithFallback({
      to: urCast.phone,
      message: `Good news! Your LumeX Wallet has been unfrozen. You can now make withdrawals again.`,
    }).catch(() => {})
  }

  return NextResponse.json({ success: true })
}
